import SUPPORTED_TOOLS from './constants/supportedTools';
import { getDisplayUnit } from './utils';
import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { utils } from '@ohif/core';
import { vec3 } from 'gl-matrix';

const Flatfoot = {
  matchingCriteria: [
    {
      valueType: 'value_type::polyline',
      points: 3,
    },
  ],
  toAnnotation: measurement => {},

  /**
   * Maps cornerstone annotation event data to measurement service format.
   *
   * @param {Object} csToolsEventDetail Cornerstone event data
   * @return {Measurement} Measurement instance
   */
  toMeasurement: (
    csToolsEventDetail,
    displaySetService,
    CornerstoneViewportService,
    getValueTypeFromToolType,
    customizationService
  ) => {
    const { annotation } = csToolsEventDetail;
    const { metadata, data, annotationUID } = annotation;
    const isLocked = getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);

    if (!metadata || !data) {
      console.warn('Flatfoot tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;
    // We add 'Flatfoot' to SUPPORTED_TOOLS conceptually,
    // but here we check against the name we assigned.
    const validToolType = toolName === 'Flatfoot' || SUPPORTED_TOOLS.includes(toolName);

    if (!validToolType) {
      throw new Error('Tool not supported');
    }

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    let displaySet;
    if (SOPInstanceUID) {
      displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
        SOPInstanceUID,
        SeriesInstanceUID
      );
    } else {
      displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];
    }

    const { points, textBox } = data.handles;

    const mappedAnnotations = getMappedAnnotations(annotation, displaySetService);

    const displayText = getDisplayText(mappedAnnotations, displaySet);
    _getReport(mappedAnnotations, points, FrameOfReferenceUID, customizationService);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      textBox,
      isLocked,
      isVisible,
      metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      frameNumber: mappedAnnotations?.[0]?.frameNumber || 1,
      toolName: metadata.toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: data.label,
      displayText: displayText,
      data: data.cachedStats,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};

function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { cachedStats } = data;
  const { referencedImageId } = metadata;

  if (!cachedStats || typeof cachedStats !== 'object' || Object.keys(cachedStats).length === 0) {
    // Fallback: calculate stats if missing
    const { points } = data.handles;
    if (points && points.length === 3) {
      const p1 = points[0];
      const p2 = points[1];
      const p3 = points[2];

      const v13 = vec3.create();
      vec3.sub(v13, p3, p1);
      const v12 = vec3.create();
      vec3.sub(v12, p2, p1);
      const len13sq = vec3.squaredLength(v13);
      let t = 0;
      if (len13sq > 0) t = vec3.dot(v12, v13) / len13sq;
      const interWorld = vec3.create();
      vec3.scaleAndAdd(interWorld, p1, v13, t);
      const distance = vec3.distance(p2, interWorld);

      const v21 = vec3.create();
      vec3.sub(v21, p1, p2);
      const v23 = vec3.create();
      vec3.sub(v23, p3, p2);
      const archAngle = vec3.angle(v21, v23) * (180 / Math.PI);

      const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
        referencedImageId,
        displaySetService,
        annotation
      );
      const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];
      const { SeriesNumber } = displaySet;

      return [
        {
          SeriesInstanceUID,
          SOPInstanceUID,
          SeriesNumber,
          frameNumber,
          unit: 'mm',
          distance,
          archAngle,
        },
      ];
    }
    return [];
  }

  const targets = Object.keys(cachedStats);

  const annotations = [];
  targets.forEach(targetId => {
    const targetStats = cachedStats[targetId];
    if (!targetStats) return;

    const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    const { SeriesNumber } = displaySet;
    const { distance, archAngle } = targetStats;
    const unit = 'mm';

    annotations.push({
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber,
      frameNumber,
      unit,
      distance,
      archAngle,
    });
  });

  return annotations;
}

function _getReport(mappedAnnotations, points, FrameOfReferenceUID, customizationService) {
  const columns = [];
  const values = [];

  columns.push('AnnotationType');
  values.push('Cornerstone:Flatfoot');

  if (mappedAnnotations && Array.isArray(mappedAnnotations)) {
    mappedAnnotations.forEach(annotation => {
      const { distance, archAngle, unit } = annotation;
      columns.push(`Arch Height (${unit})`);
      values.push(distance);
      if (archAngle !== undefined) {
        columns.push(`Arch Angle (deg)`);
        values.push(archAngle);
      }
    });
  }

  if (FrameOfReferenceUID) {
    columns.push('FrameOfReferenceUID');
    values.push(FrameOfReferenceUID);
  }

  if (points) {
    columns.push('points');
    values.push(points.map(p => p.join(' ')).join(';'));
  }

  return {
    columns,
    values,
  };
}

function getDisplayText(mappedAnnotations, displaySet) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (!mappedAnnotations || !mappedAnnotations.length) {
    return displayText;
  }

  const { distance, archAngle, unit, SeriesNumber, SOPInstanceUID, frameNumber } =
    mappedAnnotations[0];

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);

  let InstanceNumber;
  if (instance) {
    InstanceNumber = instance.InstanceNumber;
  }

  const instanceText = InstanceNumber ? ` I: ${InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  if (distance !== undefined) {
    const roundedHeight = utils.roundNumber(distance, 2);
    displayText.primary.push(`Arch Height: ${roundedHeight} ${getDisplayUnit(unit)}`);
  }

  if (archAngle !== undefined) {
    const roundedAngle = utils.roundNumber(archAngle, 2);
    displayText.primary.push(`Arch Angle: ${roundedAngle}°`);
  }

  displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}

export default Flatfoot;
