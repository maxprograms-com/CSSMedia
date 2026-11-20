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

export class ContentAlignment {

    isNormal(value?: CssValue): boolean {
        return value === undefined || (value.kind === "ident" && value.lower === "normal");
    }

    blockShift(value: CssValue | undefined, safeByDefault: boolean, free: number): number {
        // CSS Align 3 §5.1.1 and §5.1.2: the distance from the block-start content edge to the alignment subject. A <content-distribution>
        // takes its fallback alignment (§4.3), and so does a baseline value, since only cells, flex and grid items share baselines (§4.2).
        let position: string = "start";
        let safety: string | undefined;
        let baseline: boolean = false;
        let last: boolean = false;
        for (const word of this.words(value)) {
            switch (word) {
                case "safe":
                case "unsafe":
                    safety = word;
                    break;
                case "center":
                case "end":
                    position = word;
                    break;
                case "flex-end":
                    position = "end";
                    break;
                case "space-around":
                case "space-evenly":
                    position = "center";
                    safety = "safe";
                    break;
                case "space-between":
                    safety = "safe";
                    break;
                case "baseline":
                    baseline = true;
                    break;
                case "last":
                    last = true;
                    break;
                default:
                    break;
            }
        }
        if (baseline) {
            position = last ? "end" : "start";
            safety = "safe";
        }
        // §4.4: with safe, a subject that overflows "is instead aligned as if the alignment mode were flex-start".
        if (free < 0 && (safety === undefined ? safeByDefault : safety === "safe")) {
            return 0;
        }
        return position === "end" ? free : (position === "center" ? free / 2 : 0);
    }

    cellAlignment(value: CssValue | undefined, parallel: boolean): string | undefined {
        // §5.1.1: on a table cell a value other than normal replaces what vertical-align gives; §5.4: a cell takes part in first or last
        // baseline content-alignment in its row only "if its inline axis is parallel to that of the table itself".
        if (this.isNormal(value)) {
            return undefined;
        }
        const words: ReadonlyArray<string> = this.words(value);
        if (words.includes("baseline")) {
            const last: boolean = words.includes("last");
            return parallel ? (last ? "last" : "baseline") : (last ? "bottom" : "top");
        }
        if (words.includes("center") || words.includes("space-around") || words.includes("space-evenly")) {
            return "middle";
        }
        return words.includes("end") || words.includes("flex-end") ? "bottom" : "top";
    }

    keepsColumnWidth(value?: CssValue): boolean {
        // §5.1.2: "justify-content values other than normal or stretch cause the columns to take their specified column-width rather than
        // stretching to fill the container."
        const words: ReadonlyArray<string> = this.words(value);
        return words.length > 0 && !words.includes("normal") && !words.includes("stretch");
    }

    columnPlacement(value: CssValue | undefined, rightToLeft: boolean, count: number, free: number): readonly [number, number] {
        // §5.1.2: the column boxes are aligned in the inline axis, "with any spacing inserted between column boxes added to the relevant
        // column gaps"; the space before the first column and the space added to each gap. Left and right are line-left and line-right.
        let position: string = "start";
        let safety: string | undefined;
        let distribution: string | undefined;
        for (const word of this.words(value)) {
            switch (word) {
                case "safe":
                case "unsafe":
                    safety = word;
                    break;
                case "center":
                case "end":
                    position = word;
                    break;
                case "flex-end":
                    position = "end";
                    break;
                case "left":
                    position = rightToLeft ? "end" : "start";
                    break;
                case "right":
                    position = rightToLeft ? "start" : "end";
                    break;
                case "space-between":
                case "space-around":
                case "space-evenly":
                    distribution = word;
                    break;
                default:
                    break;
            }
        }
        if (distribution !== undefined) {
            // §4.3: "When space cannot be distributed", the fallback is safe flex-start for space-between and safe center for the others.
            if (free < 0) {
                return [0, 0];
            }
            if (distribution === "space-between") {
                return count > 1 ? [0, free / (count - 1)] : [0, 0];
            }
            return distribution === "space-around" ? [free / count / 2, free / count] : [free / (count + 1), free / (count + 1)];
        }
        if (free < 0 && safety === "safe") {
            return [0, 0];
        }
        return [position === "end" ? free : (position === "center" ? free / 2 : 0), 0];
    }

    private words(value?: CssValue): ReadonlyArray<string> {
        const words: Array<string> = [];
        for (const item of value === undefined ? [] : (value.kind === "list" ? value.items : [value])) {
            if (item.kind === "ident") {
                words.push(item.lower);
            }
        }
        return words;
    }
}
