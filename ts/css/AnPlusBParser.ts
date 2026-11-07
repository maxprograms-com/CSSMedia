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

import { AsciiCase } from "./AsciiCase.js";
import type { AnPlusB } from "./Stylesheet.js";
import { CssValueParser } from "./values/CssValueParser.js";

const FORMULA: RegExp = /^([+-]?\d*)n(?:\s*([+-])\s*(\d+))?$/;

export class AnPlusBParser {

    private readonly asciiCase: AsciiCase = new AsciiCase();

    parse(text: string): AnPlusB | undefined {
        const value: string = this.asciiCase.foldLower(text.trim());
        if (value === "even") {
            return { a: 2, b: 0 };
        }
        if (value === "odd") {
            return { a: 2, b: 1 };
        }
        if (CssValueParser.INTEGER.test(value)) {
            return { a: 0, b: Number(value) };
        }
        const formula: RegExpExecArray | null = FORMULA.exec(value);
        if (formula === null) {
            return undefined;
        }
        const coefficient: string = formula[1];
        const a: number = coefficient === "" || coefficient === "+" ? 1 : coefficient === "-" ? -1 : Number(coefficient);
        const b: number = formula[3] === undefined ? 0 : (formula[2] === "-" ? -Number(formula[3]) : Number(formula[3]));
        return { a, b };
    }

    matches(expression: AnPlusB, index: number): boolean {
        if (expression.a === 0) {
            return index === expression.b;
        }
        const n: number = (index - expression.b) / expression.a;
        return Number.isInteger(n) && n >= 0;
    }
}
