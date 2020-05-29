import React, {
  FunctionComponent,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { trace } from 'mobx';
import { observer } from 'mobx-react';

import * as d3 from 'd3';
import _ from 'lodash';

import { sizes, colors } from '~/ui/vars';

import { XYWH, Vec2, Line2, utils as gutils } from '~/domain/geometry';
import { ConnectorArrow, SenderArrows } from '~/domain/layout';

export interface Props {
  arrows: Map<string, SenderArrows>;
  apPositions: Map<string, Vec2>;
}

interface ArrowData {
  points: Array<Vec2>;
  handle: [Vec2, Vec2] | null;
}

type Arrow = [string, ArrowData];

const arrowLine = d3
  .line<Vec2>()
  .x(d => d.x)
  .y(d => d.y);

const startPlatePath = (d: any) => {
  const { x, y } = d[1];

  // prettier-ignore
  const r = 3, w = 10, h = 30;
  const tr = `a ${r} ${r} 0 0 1 ${r} ${r}`;
  const br = `a ${r} ${r} 0 0 1 -${r} ${r}`;

  return `
    M ${x} ${y - h / 2}
    h ${w - r}
    ${tr}
    v ${h - 2 * r}
    ${br}
    h -${w - r}
    z
  `;
};

const startPlatesEnter = (enter: any) => {
  return enter
    .append('g')
    .attr('class', (d: any) => d[0])
    .append('path')
    .attr('fill', colors.connectorFill)
    .attr('stroke', colors.arrowStroke)
    .attr('stroke-width', sizes.linkWidth)
    .attr('d', startPlatePath);
};

const startPlatesUpdate = (update: any) => {
  return update.select('g path').attr('d', startPlatePath);
};

const arrowHandle = (handle: [Vec2, Vec2] | null): string => {
  if (handle == null) return '';
  const figmaFactor = 10.87 / 11.61; // XXX: magic constants

  const [start, end] = handle;
  const width = start.distance(end);
  const height = width * figmaFactor;

  const line = Line2.throughPoints(start, end);
  const side = line.normal.mul(width / 2);

  const baseA = start.add(side);
  const baseB = start.sub(side);

  const r = 2;
  const [ar1, ar2] = gutils.roundCorner(r, [start, baseA, end]);
  const [br1, br2] = gutils.roundCorner(r, [start, baseB, end]);
  const [er1, er2] = gutils.roundCorner(r, [baseA, end, baseB]);

  return `
    M ${start.x} ${start.y}
    L ${ar1.x} ${ar1.y}
    A ${r} ${r} 0 0 0 ${ar2.x} ${ar2.y}
    L ${er1.x} ${er1.y}
    A ${r} ${r} 0 0 0 ${er2.x} ${er2.y}
    L ${br2.x} ${br2.y}
    A ${r} ${r} 0 0 0 ${br1.x} ${br1.y}
    Z
  `;
};

const arrowsEnter = (enter: any) => {
  const arrowGroup = enter.append('g').attr('class', (d: Arrow) => d[0]);

  arrowGroup
    .append('path')
    .attr('class', 'line')
    .attr('stroke', colors.arrowStroke)
    .attr('stroke-width', sizes.linkWidth)
    .attr('fill', 'none')
    .attr('d', (d: Arrow) => arrowLine(d[1].points));

  arrowGroup
    .append('path')
    .attr('class', 'handle')
    .attr('fill', colors.arrowHandle)
    .attr('stroke', 'none')
    .attr('d', (d: Arrow) => arrowHandle(d[1].handle));

  return arrowGroup;
};

const arrowsUpdate = (update: any) => {
  update.select('path.line').attr('d', (d: Arrow) => arrowLine(d[1].points));
  update
    .select('path.handle')
    .attr('d', (d: Arrow) => arrowHandle(d[1].handle));

  return update;
};

const feetsEnter = (enter: any) => {
  return enter
    .append('g')
    .attr('class', (d: any) => d[0])
    .append('line')
    .attr('x1', (d: any) => d[1][0].x)
    .attr('y1', (d: any) => d[1][0].y)
    .attr('x2', (d: any) => d[1][1].x)
    .attr('y2', (d: any) => d[1][1].y)
    .attr('stroke', colors.feetStroke)
    .attr('stroke-width', sizes.feetWidth);
};

const feetsUpdate = (update: any) => {
  return update
    .select('line')
    .attr('x1', (d: any) => d[1][0].x)
    .attr('y1', (d: any) => d[1][0].y)
    .attr('x2', (d: any) => d[1][1].x)
    .attr('y2', (d: any) => d[1][1].y);
};

const connectorsEnter = (enter: any) => {
  return enter
    .append('g')
    .attr('class', (d: any) => d[0])
    .append('circle')
    .attr('cx', (d: any) => d[1].x)
    .attr('cy', (d: any) => d[1].y)
    .attr('r', 7.5)
    .attr('stroke', colors.arrowStroke)
    .attr('stroke-width', sizes.linkWidth)
    .attr('fill', colors.connectorFill);
};

const connectorsUpdate = (update: any) => {
  return update
    .select('circle')
    .attr('cx', (d: any) => d[1].x)
    .attr('cy', (d: any) => d[1].y);
};

// Assumed, points is an array of 4 points of arrow
// * -> * \
//         \ <- this is where arrow handle should be
//          \ * -> *
const arrowHandleFromPoints = (points: Vec2[]): [Vec2, Vec2] | null => {
  if (points.length < 3) return null;

  const [start, end] = [points[1], points[2]];
  const mid = start.linterp(end, 0.5);
  const direction = end.sub(start).normalize();

  if (direction.isZero()) return null;

  const handleLength = sizes.arrowHandleWidth;
  const handleFrom = mid.sub(direction.mul(handleLength / 2));
  const handleTo = mid.add(direction.mul(handleLength / 2));

  return [handleFrom, handleTo];
};

const manageArrows = (props: Props, g: SVGGElement) => {
  const arrowsMap = props.arrows;
  const apPositions = props.apPositions;

  const rootGroup = d3.select(g);
  const startPlatesGroup = rootGroup.select('.start-plates');
  const arrowsGroup = rootGroup.select('.arrows');
  const connectorsGroup = rootGroup.select('.connectors');
  const feetsGroup = rootGroup.select('.feets');

  const startPlates: Array<[string, Vec2]> = [];
  const arrows: Array<Arrow> = [];
  const connectors: Array<[string, Vec2]> = [];
  const arrowHandles: Array<[string, [Vec2, Vec2]]> = [];
  const feets: Array<[string, [Vec2, Vec2]]> = [];

  // Just split data to simple arrays so that it will be easier to work
  // with them in d3
  arrowsMap.forEach((senderArrows, senderId) => {
    startPlates.push([senderId, senderArrows.startPoint]);

    senderArrows.arrows.forEach((connectorArrow, receiverId) => {
      const fromToId = `${senderId} -> ${receiverId}`;
      const allPoints = [senderArrows.startPoint].concat(connectorArrow.points);
      const arrowHandle = arrowHandleFromPoints(allPoints);

      // prettier-ignore
      arrows.push([fromToId, {
          points: allPoints,
          handle: arrowHandle,
      }]);

      const connectorPosition = connectorArrow.connector.position;
      connectors.push([fromToId, connectorPosition]);

      connectorArrow.connector.apIds.forEach(apId => {
        const feetId = `${fromToId} -> ${apId}`;
        const apPosition = apPositions.get(apId);

        if (apPosition == null) return;

        feets.push([feetId, [connectorPosition, apPosition]]);
      });
    });
  });

  const fns = {
    startPlates: {
      enter: startPlatesEnter,
      update: startPlatesUpdate,
    },
    arrows: {
      enter: arrowsEnter,
      update: arrowsUpdate,
    },
    connectors: {
      enter: connectorsEnter,
      update: connectorsUpdate,
    },
    feets: {
      enter: feetsEnter,
      update: feetsUpdate,
    },
    common: {
      exit: (exit: any) => exit.remove(),
    },
  };

  startPlatesGroup
    .selectAll('g')
    .data(startPlates, (d: any) => d[0])
    .join(fns.startPlates.enter, fns.startPlates.update);

  arrowsGroup
    .selectAll('g')
    .data(arrows, (d: any) => d[0])
    .join(fns.arrows.enter, fns.arrows.update);

  connectorsGroup
    .selectAll('g')
    .data(connectors, (d: any) => d[0])
    .join(fns.connectors.enter, fns.connectors.update);

  feetsGroup
    .selectAll('g')
    .data(feets, (d: any) => d[0])
    .join(fns.feets.enter, fns.feets.update);
};

// This component manages multiple arrows to be able to draw them
// properly using d3
export const Component: FunctionComponent<Props> = observer(
  function ArrowsRenderer(props: Props) {
    const rootRef = useRef<SVGGElement>(null as any);

    useEffect(() => {
      if (rootRef == null || rootRef.current == null) return;

      manageArrows(props, rootRef.current);
    }, [props.arrows, props.apPositions, rootRef]);

    return (
      <g ref={rootRef} className="arrows">
        <g className="arrows" />
        <g className="start-plates" />
        <g className="feets" />
        <g className="connectors" />
      </g>
    );
  },
);

export const ArrowsRenderer = React.memo(Component);