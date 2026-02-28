import { AngleTool, drawing, annotation, utilities as csUtils } from '@cornerstonejs/tools';
import { vec3 } from 'gl-matrix';
import { utils } from '@ohif/core';

/**
 * FlatfootTool - A tool to measure the Arch Height of a foot.
 * It uses 3 points:
 * Point 1 & 3: Define the baseline (floor).
 * Point 2: The apex of the arch.
 * The tool calculates the perpendicular distance from Point 2 to the Baseline (1-3).
 */
class FlatfootTool extends AngleTool {
  static toolName = 'Flatfoot';

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        showAngleArc: false,
        arcOffset: 5,
        preventHandleOutsideImage: false,
        getTextLines: (data, targetId) => {
          const stats = data.cachedStats?.[targetId];
          if (!stats) return;
          const { distance, archAngle } = stats;
          if (distance === undefined) return;
          return [
            `Height: ${utils.roundNumber(distance, 2)} mm`,
            `Angle: ${utils.roundNumber(archAngle, 2)}°`,
          ];
        },
      },
    }
  ) {
    super(toolProps, defaultToolProps);

    // CRITICAL: Explicitly bind the render method to avoid it being clobbered by AngleTool
    this.renderAnnotation = this._renderFlatfootAnnotation.bind(this);
  }

  _calculateCachedStats(annotation, renderingEngine, enabledElement) {
    const { data } = annotation;
    const { points } = data.handles;
    const viewport = renderingEngine.getViewport(enabledElement.viewportId);

    if (points.length < 3) {
      return data.cachedStats;
    }

    const p1 = points[0];
    const p2 = points[1]; // The Apex
    const p3 = points[2];

    const lineVec = vec3.create();
    vec3.sub(lineVec, p3, p1);
    const pointVec = vec3.create();
    vec3.sub(pointVec, p2, p1);

    const lineLenSq = vec3.squaredLength(lineVec);
    let t = 0;
    if (lineLenSq > 0) {
      t = vec3.dot(pointVec, lineVec) / lineLenSq;
    }

    const intersectionWorld = vec3.create();
    vec3.scaleAndAdd(intersectionWorld, p1, lineVec, t);

    const distanceWorld = vec3.distance(p2, intersectionWorld);

    // Arch Angle Calculation (Angle at P2 between P1-P2 and P2-P3)
    const v1 = vec3.create();
    vec3.sub(v1, p1, p2);
    const v2 = vec3.create();
    vec3.sub(v2, p3, p2);
    const angle = vec3.angle(v1, v2) * (180 / Math.PI);

    const targetId = this.getTargetId(viewport);

    if (!data.cachedStats) {
      data.cachedStats = {};
    }

    data.cachedStats[targetId] = {
      distance: distanceWorld,
      archAngle: angle,
      points: [p2, intersectionWorld],
    };

    annotation.invalidated = false;
    return data.cachedStats;
  }

  /**
   * Custom rendering logic for the Flatfoot tool.
   */
  _renderFlatfootAnnotation(enabledElement: any, svgDrawingHelper: any): boolean {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;
    const annotationUIDs = annotation.state.getAnnotations(this.getToolName(), element);

    if (!annotationUIDs || annotationUIDs.length === 0) {
      return renderStatus;
    }

    const annotations = this.filterInteractableAnnotationsForElement(element, annotationUIDs);

    if (!annotations || annotations.length === 0) {
      return renderStatus;
    }

    const targetId = this.getTargetId(viewport);
    const styleSpecifier: any = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    };

    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i] as any;
      const { annotationUID, data } = ann;
      const { points, activeHandleIndex } = data.handles;

      styleSpecifier.annotationUID = annotationUID;

      // Get styles (color, lineWidth, etc.)
      const style = this.getAnnotationStyle({
        annotation: ann,
        styleSpecifier,
      });
      const { color, lineWidth } = style;
      const lineDash = [4, 4]; // Dashed line for baseline

      const canvasCoordinates = points.map(p => viewport.worldToCanvas(p));

      // 0. Calculate cached stats when we have all 3 points
      if (
        points.length >= 3 &&
        (ann.invalidated || !data.cachedStats || !data.cachedStats[targetId])
      ) {
        const renderingEngine = viewport.getRenderingEngine();
        this._calculateCachedStats(ann, renderingEngine, enabledElement);
      }

      // 1. Draw baseline (P1 to P3) as a dashed line
      if (canvasCoordinates.length >= 3) {
        drawing.drawLine(
          svgDrawingHelper,
          annotationUID,
          'baseline',
          canvasCoordinates[0],
          canvasCoordinates[2],
          {
            color,
            width: lineWidth,
            lineDash,
          }
        );

        // 2. Draw line P1 to P2
        drawing.drawLine(
          svgDrawingHelper,
          annotationUID,
          'leg1',
          canvasCoordinates[0],
          canvasCoordinates[1],
          {
            color,
            width: lineWidth,
          }
        );

        // 3. Draw line P2 to P3
        drawing.drawLine(
          svgDrawingHelper,
          annotationUID,
          'leg2',
          canvasCoordinates[1],
          canvasCoordinates[2],
          {
            color,
            width: lineWidth,
          }
        );

        // 4. Calculate Intersection for drawing
        const p1 = points[0];
        const p2 = points[1];
        const p3 = points[2];
        const lineVec = vec3.create();
        vec3.sub(lineVec, p3, p1);
        const pointVec = vec3.create();
        vec3.sub(pointVec, p2, p1);
        const lineLenSq = vec3.squaredLength(lineVec);
        let t = 0;
        if (lineLenSq > 0) t = vec3.dot(pointVec, lineVec) / lineLenSq;
        const intersectionWorld = vec3.create();
        vec3.scaleAndAdd(intersectionWorld, p1, lineVec, t);
        const intersectionCanvas = viewport.worldToCanvas(intersectionWorld);

        // 5. Draw the yellow height line
        drawing.drawLine(
          svgDrawingHelper,
          annotationUID,
          'height-line',
          canvasCoordinates[1],
          intersectionCanvas,
          {
            color: 'rgb(255, 255, 0)',
            width: 2,
          }
        );

        // 6. Draw the measurement text using renderLinkedTextBoxAnnotation (same as AngleTool)
        if (data.cachedStats?.[targetId]) {
          const textLines = this.configuration.getTextLines(data, targetId);
          if (textLines) {
            const vertexAnchor = [canvasCoordinates[1], canvasCoordinates[1]];
            this.renderLinkedTextBoxAnnotation({
              enabledElement,
              svgDrawingHelper,
              annotation: ann,
              styleSpecifier,
              textLines,
              canvasCoordinates,
              placementPoints: vertexAnchor,
            });
          }
        }

        renderStatus = true;
      }

      // 7. Draw handles manually
      // This avoids the 'forEach is not a function' crash identified in drawHandles utility
      for (let j = 0; j < canvasCoordinates.length; j++) {
        drawing.drawHandle(
          svgDrawingHelper,
          annotationUID,
          'handle',
          canvasCoordinates[j],
          {
            color: activeHandleIndex === j ? 'rgb(0, 255, 0)' : color,
            handleRadius: '4',
          },
          j
        );
      }
    }

    return renderStatus;
  }
}

export default FlatfootTool;
