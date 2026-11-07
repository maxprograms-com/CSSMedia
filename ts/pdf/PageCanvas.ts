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

import type { MarginBoxName } from "../css/Stylesheet.js";
import type { ComputedStyle } from "./ComputedStyle.js";

export interface PageGroup {
    name: string;
    position: number;
}

export interface PageContext {
    name?: string;
    first: boolean;
    side: "left" | "right";
    blank: boolean;
    position: number;
    groups: ReadonlyArray<PageGroup>;
}

export interface Size {
    width: number;
    height: number;
}

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Edges {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface MarginAreas {
    topLeftCorner: Rectangle;
    top: Rectangle;
    topRightCorner: Rectangle;
    right: Rectangle;
    bottomRightCorner: Rectangle;
    bottom: Rectangle;
    bottomLeftCorner: Rectangle;
    left: Rectangle;
}

export interface PageMarginBox {
    name: MarginBoxName;
    style: ComputedStyle;
}

export interface PageCanvas {
    context: PageContext;
    style: ComputedStyle;
    sheet: Size;
    margins: Edges;
    borders: Edges;
    padding: Edges;
    borderBox: Rectangle;
    pageArea: Rectangle;
    bleed: number;
    cropMarks: boolean;
    crossMarks: boolean;
    orientation: "upright" | "rotate-left" | "rotate-right";
    marginAreas: MarginAreas;
    marginBoxes: ReadonlyArray<PageMarginBox>;
}
