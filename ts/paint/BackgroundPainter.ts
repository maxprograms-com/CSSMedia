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
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { Rectangle } from "../pdf/PageCanvas.js";
import type { PdfPage } from "../writer/PdfPage.js";
import type { BorderPainter, CornerRadii, PhysicalSides } from "./BorderPainter.js";
import type { ColorOutput } from "./ColorOutput.js";

const NO_RADII: CornerRadii = [0, 0, 0, 0, 0, 0, 0, 0];

export class BackgroundPainter {

    private readonly colors: ColorOutput;
    private readonly borders: BorderPainter;

    constructor(colors: ColorOutput, borders: BorderPainter) {
        this.colors = colors;
        this.borders = borders;
    }

    paint(rectangle: Rectangle, borders: PhysicalSides, padding: PhysicalSides, style: ComputedStyle, pdf: PdfPage, clip?: string, radii: CornerRadii = NO_RADII): void {
        // CSS Backgrounds 3 §2.2: "The background color is clipped according to the background-clip value associated with
        // the bottom-most background image layer".
        const images: CssValue | undefined = style.values["background-image"];
        if (images !== undefined && (images.kind === "list" ? images.items : [images]).some((image: CssValue) => !(image.kind === "ident" && image.lower === "none"))) {
            throw new Error("The painting of background-image is not implemented");
        }
        const area: string = clip ?? this.lastClip(style.values["background-clip"]);
        if (area !== "border-box" && area !== "padding-box" && area !== "content-box") {
            throw new Error("The painting of background-clip: " + area + " is not implemented");
        }
        const inset: PhysicalSides = area === "border-box" ? [0, 0, 0, 0]
            : (area === "padding-box" ? borders : [borders[0] + padding[0], borders[1] + padding[1], borders[2] + padding[2], borders[3] + padding[3]]);
        const shape: readonly [Rectangle, CornerRadii] = this.borders.inner(rectangle, inset, radii);
        if (shape[0].width <= 0 || shape[0].height <= 0) {
            return;
        }
        pdf.content.save();
        if (this.colors.fill(style.values["background-color"], style, pdf)) {
            this.borders.shape(shape[0], shape[1], pdf);
            pdf.content.fill(false);
        }
        pdf.content.restore();
    }

    private lastClip(value?: CssValue): string {
        if (value === undefined) {
            return "border-box";
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "comma" ? value.items : [value];
        const last: CssValue = items[items.length - 1];
        // CSS Backgrounds 4 §2.8: the only value of more than one word is border-area with text.
        return last.kind === "ident" ? last.lower : "border-area text";
    }
}
