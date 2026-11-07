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

import { PdfSyntax } from "./PdfSyntax.js";

const KAPPA: number = 0.5522847498;

export class ContentStream {

    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly operations: Array<string> = [];

    save(): void {
        this.operations.push("q");
    }

    restore(): void {
        this.operations.push("Q");
    }

    transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
        this.operations.push(this.syntax.numbers([a, b, c, d, e, f]) + " cm");
    }

    lineWidth(width: number): void {
        this.operations.push(this.syntax.number(width) + " w");
    }

    lineCap(style: number): void {
        this.operations.push(style + " J");
    }

    lineJoin(style: number): void {
        this.operations.push(style + " j");
    }

    miterLimit(limit: number): void {
        this.operations.push(this.syntax.number(limit) + " M");
    }

    dash(pattern: ReadonlyArray<number>, phase: number): void {
        this.operations.push("[" + this.syntax.numbers(pattern) + "] " + this.syntax.number(phase) + " d");
    }

    graphicsState(name: string): void {
        this.operations.push(this.syntax.name(name) + " gs");
    }

    fillSpace(name: string): void {
        // ISO 32000-2 §8.6.8: cs sets the colour space for nonstroking operations, and its initial colour.
        this.operations.push(this.syntax.name(name) + " cs");
    }

    strokeSpace(name: string): void {
        this.operations.push(this.syntax.name(name) + " CS");
    }

    fillColor(components: ReadonlyArray<number>): void {
        // §8.6.8: scn takes the components of the current colour space, whatever its family.
        this.operations.push(this.syntax.numbers(components) + " scn");
    }

    strokeColor(components: ReadonlyArray<number>): void {
        this.operations.push(this.syntax.numbers(components) + " SCN");
    }

    fillPattern(name: string): void {
        // ISO 32000-2 §8.7.3.1: a colored pattern is selected by its name as the only operand of scn in the Pattern space.
        this.operations.push("/Pattern cs " + this.syntax.name(name) + " scn");
    }

    strokePattern(name: string): void {
        this.operations.push("/Pattern CS " + this.syntax.name(name) + " SCN");
    }

    moveTo(x: number, y: number): void {
        this.operations.push(this.syntax.numbers([x, y]) + " m");
    }

    lineTo(x: number, y: number): void {
        this.operations.push(this.syntax.numbers([x, y]) + " l");
    }

    curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
        this.operations.push(this.syntax.numbers([x1, y1, x2, y2, x3, y3]) + " c");
    }

    rectangle(x: number, y: number, width: number, height: number): void {
        this.operations.push(this.syntax.numbers([x, y, width, height]) + " re");
    }

    roundedRectangle(x: number, y: number, width: number, height: number, radii: ReadonlyArray<number>): void {
        // The radii are the horizontal and vertical radius of the top left, top right, bottom right and bottom left corners;
        // each quarter ellipse is a cubic Bézier curve with its control points at 0.5523 of the radius from its ends.
        const right: number = x + width;
        const bottom: number = y + height;
        this.moveTo(x + radii[0], y);
        this.lineTo(right - radii[2], y);
        this.curveTo(right - radii[2] * (1 - KAPPA), y, right, y + radii[3] * (1 - KAPPA), right, y + radii[3]);
        this.lineTo(right, bottom - radii[5]);
        this.curveTo(right, bottom - radii[5] * (1 - KAPPA), right - radii[4] * (1 - KAPPA), bottom, right - radii[4], bottom);
        this.lineTo(x + radii[6], bottom);
        this.curveTo(x + radii[6] * (1 - KAPPA), bottom, x, bottom - radii[7] * (1 - KAPPA), x, bottom - radii[7]);
        this.lineTo(x, y + radii[1]);
        this.curveTo(x, y + radii[1] * (1 - KAPPA), x + radii[0] * (1 - KAPPA), y, x + radii[0], y);
        this.closePath();
    }

    closePath(): void {
        this.operations.push("h");
    }

    fill(evenOdd: boolean): void {
        this.operations.push(evenOdd ? "f*" : "f");
    }

    stroke(): void {
        this.operations.push("S");
    }

    clip(evenOdd: boolean): void {
        // §8.5.4: W modifies the clipping path at the next painting operator, which n is when nothing is painted.
        this.operations.push((evenOdd ? "W*" : "W") + " n");
    }

    shade(name: string): void {
        this.operations.push(this.syntax.name(name) + " sh");
    }

    paintXObject(name: string): void {
        this.operations.push(this.syntax.name(name) + " Do");
    }

    beginText(): void {
        this.operations.push("BT");
    }

    endText(): void {
        this.operations.push("ET");
    }

    font(name: string, size: number): void {
        this.operations.push(this.syntax.name(name) + " " + this.syntax.number(size) + " Tf");
    }

    textMatrix(a: number, b: number, c: number, d: number, e: number, f: number): void {
        this.operations.push(this.syntax.numbers([a, b, c, d, e, f]) + " Tm");
    }

    textRenderingMode(mode: number): void {
        this.operations.push(mode + " Tr");
    }

    showText(codes: string): void {
        this.operations.push(codes + " Tj");
    }

    showAdjusted(parts: ReadonlyArray<string | number>): void {
        // §9.4.3: in TJ a number moves the next glyph back by thousandths of a unit of text space.
        let items: string = "";
        for (const part of parts) {
            items += (items.length === 0 ? "" : " ") + (typeof part === "string" ? part : this.syntax.number(part));
        }
        this.operations.push("[" + items + "] TJ");
    }

    beginMarked(tag: string, properties: string): void {
        // §14.6: BDC with a property list given inline or by the name of a Properties resource.
        this.operations.push(this.syntax.name(tag) + " " + properties + " BDC");
    }

    endMarked(): void {
        this.operations.push("EMC");
    }

    bytes(): Buffer {
        return Buffer.from(this.operations.join("\n") + "\n", "latin1");
    }
}
