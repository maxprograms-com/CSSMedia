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
import { VERTICAL_UPRIGHT_RANGES } from "./generated/VerticalOrientationData.js";

export type TextOrientation = "horizontal" | "upright" | "mixed";

export class VerticalOrientation {

    of(values: Readonly<Record<string, CssValue>>): TextOrientation {
        // CSS Writing Modes 4 §3.2: with sideways-rl and sideways-lr "the typographic mode is horizontal"; §5.1: with
        // text-orientation: sideways all text is typeset "as if in a horizontal layout, but rotated 90° clockwise".
        const mode: CssValue | undefined = values["writing-mode"];
        if (mode === undefined || mode.kind !== "ident" || (mode.lower !== "vertical-rl" && mode.lower !== "vertical-lr")) {
            return "horizontal";
        }
        const orientation: CssValue | undefined = values["text-orientation"];
        const keyword: string = orientation !== undefined && orientation.kind === "ident" ? orientation.lower : "mixed";
        return keyword === "sideways" ? "horizontal" : (keyword === "upright" ? "upright" : "mixed");
    }

    isUpright(codepoint: number): boolean {
        // CSS Writing Modes 4 §5.1.2: upright "if its orientation property is U, Tu, or Tr", sideways if it is R.
        let low: number = 0;
        let high: number = VERTICAL_UPRIGHT_RANGES.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (codepoint < VERTICAL_UPRIGHT_RANGES[middle][0]) {
                high = middle - 1;
            } else if (codepoint > VERTICAL_UPRIGHT_RANGES[middle][1]) {
                low = middle + 1;
            } else {
                return true;
            }
        }
        return false;
    }
}
