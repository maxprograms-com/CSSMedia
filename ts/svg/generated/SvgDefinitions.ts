/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

import type { CssPropertyDefinition } from "../../css/generated/CssDefinitions.js";

export const SVG_PROPERTIES: ReadonlyArray<CssPropertyDefinition> = [
    { name: "color-interpolation", value: "auto | sRGB | linearRGB", initial: "sRGB", appliesTo: "container elements, graphics elements, gradient elements, ‘use’ and ‘animate’", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "cx", value: "<length-percentage>", initial: "0", appliesTo: "‘circle’ and ‘ellipse’ elements", inherited: "no", percentages: "refer to the width of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" },
    { name: "cy", value: "<length-percentage>", initial: "0", appliesTo: "‘circle’ and ‘ellipse’ elements", inherited: "no", percentages: "refer to the height of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" },
    { name: "d", value: "none | <string>", initial: "none", appliesTo: "‘path’", inherited: "no", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "fill", value: "<paint>", initial: "black", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified, but with <color> values computed and <url> values made absolute", spec: "SVG2" },
    { name: "fill-opacity", value: "<'opacity'>", initial: "1", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "the specified value converted to a number, clamped to the range [0,1]", spec: "SVG2" },
    { name: "fill-rule", value: "nonzero | evenodd", initial: "nonzero", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "marker", value: "none | <marker-ref>", initial: "not defined for shorthand properties", appliesTo: "shapes", inherited: "yes", percentages: "N/A", computedValue: "see individual properties", spec: "SVG2" },
    { name: "marker-end", value: "none | <marker-ref>", initial: "none", appliesTo: "shapes", inherited: "yes", percentages: "N/A", computedValue: "as specified, but with <url> values (that are part of a <marker-ref>) made absolute", spec: "SVG2" },
    { name: "marker-knockout-left", value: "<knockout-offset> | <knockout-shape> [ at <knockout-offset> ]?", initial: "0", appliesTo: "‘marker’", inherited: "no", percentages: "see prose", computedValue: "as specified", spec: "svg-markers" },
    { name: "marker-knockout-right", value: "<knockout-offset> | <knockout-shape> [ at <knockout-offset> ]?", initial: "0", appliesTo: "‘marker’", inherited: "no", percentages: "see prose", computedValue: "as specified", spec: "svg-markers" },
    { name: "marker-mid", value: "none | <marker-ref>", initial: "none", appliesTo: "shapes", inherited: "yes", percentages: "N/A", computedValue: "as specified, but with <url> values (that are part of a <marker-ref>) made absolute", spec: "SVG2" },
    { name: "marker-pattern", value: "<marker-gap>? <marker-ref-group> [ <marker-gap> <marker-ref-group> ]* <marker-gap>?", initial: "none", appliesTo: "markable elements", inherited: "yes", percentages: "refer to the length of the path", computedValue: "as specified, but with <url> values (that are part of a <marker-ref>) made absolute", spec: "svg-markers" },
    { name: "marker-segment", value: "none | <marker-ref>", initial: "none", appliesTo: "markable elements", inherited: "yes", percentages: "N/A", computedValue: "as specified, but with <url> values (that are part of a <marker-ref>) made absolute", spec: "svg-markers" },
    { name: "marker-start", value: "none | <marker-ref>", initial: "none", appliesTo: "shapes", inherited: "yes", percentages: "N/A", computedValue: "as specified, but with <url> values (that are part of a <marker-ref>) made absolute", spec: "SVG2" },
    { name: "paint-order", value: "normal | [ fill || stroke || markers ]", initial: "normal", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "path-length", value: "none | <length [0,∞]>", initial: "none", appliesTo: "‘path’, ‘circle’, ‘ellipse’, ‘line’, ‘polygon’, ‘polyline’, ‘rect’", inherited: "no", percentages: "N/A", computedValue: "the keyword none, or an absolute length", spec: "SVG2" },
    { name: "r", value: "<length-percentage>", initial: "0", appliesTo: "‘circle’ element", inherited: "no", percentages: "refer to the normalized diagonal of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" },
    { name: "rx", value: "<length-percentage> | auto", initial: "auto", appliesTo: "‘ellipse’, ‘rect’ elements", inherited: "no", percentages: "refer to the width of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" },
    { name: "ry", value: "<length-percentage> | auto", initial: "auto", appliesTo: "‘ellipse’, ‘rect’", inherited: "no", percentages: "refer to the height of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" },
    { name: "shape-rendering", value: "auto | optimizeSpeed | crispEdges | geometricPrecision", initial: "auto", appliesTo: "shapes", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "stop-color", value: "<'color'>", initial: "black", appliesTo: "‘stop’ elements", inherited: "no", percentages: "N/A", spec: "SVG2" },
    { name: "stop-opacity", value: "<'opacity'>", initial: "1", appliesTo: "‘stop’ elements", inherited: "no", percentages: "N/A", computedValue: "the specified value converted to a number, clamped to the range [0,1]", spec: "SVG2" },
    { name: "stroke", value: "<paint>", initial: "none", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified, but with <color> values computed and <url> values made absolute", spec: "SVG2" },
    { name: "stroke-alignment", value: "center | inner | outer", initial: "center", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "svg-strokes" },
    { name: "stroke-dashadjust", value: "none | [stretch | compress] [dashes | gaps]?", initial: "none", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "svg-strokes" },
    { name: "stroke-dasharray", value: "none | <dasharray>", initial: "none", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "refer to the normalized diagonal of the current SVG viewport (see Units)", computedValue: "as comma separated list of absolute lengths or percentages, numbers converted to absolute lengths first, or keyword specified", spec: "SVG2" },
    { name: "stroke-dashcorner", value: "none | <length>", initial: "none", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "refer to the size of the current viewport (see Units)", computedValue: "absolute length or keyword specified", spec: "svg-strokes" },
    { name: "stroke-dashoffset", value: "<length-percentage> | <number>", initial: "0", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "refer to the normalized diagonal of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage, numbers converted to absolute lengths first", spec: "SVG2" },
    { name: "stroke-linecap", value: "butt | round | square", initial: "butt", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "stroke-linejoin", value: "miter | round | bevel", initial: "miter", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "stroke-miterlimit", value: "<number>", initial: "4", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "stroke-opacity", value: "<'opacity'>", initial: "1", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "N/A", computedValue: "the specified value converted to a number, clamped to the range [0,1]", spec: "SVG2" },
    { name: "stroke-width", value: "<length-percentage> | <number>", initial: "1px", appliesTo: "shapes and text content elements", inherited: "yes", percentages: "refer to the normalized diagonal of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage, numbers converted to absolute lengths first", spec: "SVG2" },
    { name: "text-anchor", value: "start | middle | end", initial: "start", appliesTo: "text content elements", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "text-rendering", value: "auto | optimizeSpeed | optimizeLegibility | geometricPrecision", initial: "auto", appliesTo: "‘text’", inherited: "yes", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "vector-effect", value: "none | non-scaling-stroke | non-scaling-size | non-rotation | fixed-position", initial: "none", appliesTo: "graphics elements and ‘use’", inherited: "no", percentages: "N/A", computedValue: "as specified", spec: "SVG2" },
    { name: "x", value: "<length-percentage>", initial: "0", appliesTo: "‘svg’, ‘rect’, ‘image’, ‘foreignObject’ elements", inherited: "no", percentages: "refer to the width of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" },
    { name: "y", value: "<length-percentage>", initial: "0", appliesTo: "‘svg’, ‘rect’, ‘image’, ‘foreignObject’ elements", inherited: "no", percentages: "refer to the height of the current SVG viewport (see Units)", computedValue: "an absolute length or percentage", spec: "SVG2" }
];

export const SVG_TYPES: ReadonlyArray<readonly [string, string]> = [
    ["<dasharray>", "[ [ <length-percentage> | <number> ]+ ]#"],
    ["<marker-ref>", "<url>"],
    ["<paint>", "none | <color> | <url> [none | <color>]? | context-fill | context-stroke"],
    ["<points>", "[ <number>+ ]#"]
];
