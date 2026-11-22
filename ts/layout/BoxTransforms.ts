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

import type { CssValue } from "../css/values/CssValue.js";
import type { Box, Homography } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { Matrix4 } from "../svg/SvgGeometry.js";
import { SvgGeometry } from "../svg/SvgGeometry.js";
import type { BoxSizes, Transform } from "./BoxSizes.js";
import type { BoxFragment } from "./Fragment.js";

const OWN_TRANSFORMS: ReadonlyArray<string> = ["transform", "translate", "rotate", "scale"];

export class BoxTransforms {

    private readonly sizes: BoxSizes;
    private readonly geometry: SvgGeometry = new SvgGeometry();
    private readonly displays: DisplayTypes = new DisplayTypes();

    constructor(sizes: BoxSizes) {
        this.sizes = sizes;
    }

    matrixOf(fragment: BoxFragment, transform: Transform, view: Matrix4 | undefined): Matrix4 | undefined {
        // CSS Transforms 2 §4.1.1: the perspective of the parent, then the element's own transform about its origin.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        if (OWN_TRANSFORMS.every((property: string) => BoxTransforms.isNone(values[property])) || !this.displays.isTransformable(fragment.box.display, fragment.box.replaced)) {
            return undefined;
        }
        const own: Matrix4 = this.geometry.spatial(values, this.reference(fragment, transform));
        return view === undefined ? own : this.geometry.multiply4(view, own);
    }

    eye(fragment: BoxFragment, transform: Transform): Matrix4 | undefined {
        // CSS Transforms 2 §12: the perspective of a box applies to the transforms of its children, about its perspective-origin.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        const distance: CssValue | undefined = values["perspective"];
        if (BoxTransforms.isNone(distance) || !this.displays.isTransformable(fragment.box.display, fragment.box.replaced)) {
            return undefined;
        }
        return this.geometry.perspectiveOf(this.sizes.pixels(distance as CssValue, 0), values, this.reference(fragment, transform));
    }

    childView(fragment: BoxFragment, transform: Transform, view: Matrix4 | undefined): Matrix4 | undefined {
        // The perspective of a box reaches its element children, through the anonymous boxes between.
        return this.named(fragment) ? this.eye(fragment, transform) : view;
    }

    reference(fragment: BoxFragment, transform: Transform): Box {
        // CSS Transforms 1 §6: for a box of the CSS box model fill-box is the content box, and stroke-box and view-box are
        // the border box.
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const box: CssValue | undefined = fragment.box.style.values["transform-box"];
        const keyword: string = box !== undefined && box.kind === "ident" ? box.lower : "";
        if (keyword !== "content-box" && keyword !== "fill-box") {
            return [area[0], area[1], area[2], area[3]];
        }
        const own: number = this.sizes.frame(fragment.box.style);
        const insets: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < 4; side++) {
            insets[this.sizes.physicalSide(own, side)] = (fragment.border?.[side] ?? 0) + (fragment.padding?.[side] ?? 0);
        }
        return [area[0] + insets[3], area[1] + insets[0], Math.max(0, area[2] - insets[1] - insets[3]), Math.max(0, area[3] - insets[0] - insets[2])];
    }

    named(fragment: BoxFragment): boolean {
        // A box that no element generates alone can still carry its element's values, as a wrapper box does; an anonymous box has none of its own.
        return fragment.box.element !== undefined || fragment.box.pseudoElement !== undefined || fragment.box.style.values !== fragment.box.style.inherited;
    }

    lens(outer: Homography | undefined, matrix: Matrix4 | undefined): Homography | undefined | null {
        // The projection that takes a box's plane to the space it is drawn in; null for a transform that CSS Transforms 1 §10 does not display.
        if (matrix === undefined) {
            return outer;
        }
        const homography: Homography = this.geometry.homography(matrix);
        if (this.geometry.invertHomography(homography) === undefined) {
            return null;
        }
        return this.geometry.composeHomography(outer ?? PathGeometry.IDENTITY3, homography);
    }

    projected(lens: Homography | undefined, area: Box): Box | undefined {
        // The axis-aligned rectangle that holds what the corners of an area go to.
        if (lens === undefined) {
            return area;
        }
        let result: Box | undefined;
        for (const [x, y] of [[area[0], area[1]], [area[0] + area[2], area[1]], [area[0], area[1] + area[3]], [area[0] + area[2], area[1] + area[3]]]) {
            const point: readonly [number, number] | undefined = this.geometry.project(lens, x, y);
            if (point !== undefined) {
                result = this.geometry.union(result, [point[0], point[1], 0, 0]);
            }
        }
        return result;
    }

    static isNone(value?: CssValue): boolean {
        if (value === undefined) {
            return true;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.every((item: CssValue) => item.kind === "ident" && item.lower === "none");
    }
}
