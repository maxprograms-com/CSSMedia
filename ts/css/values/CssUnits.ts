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

import type { BaseType } from "./CssValue.js";

interface UnitDefinition {
    base: BaseType;
    factor?: number;
}

const RELATIVE_LENGTHS: ReadonlyArray<string> = [
    "em", "rem", "ex", "rex", "cap", "rcap", "ch", "rch", "ic", "ric", "lh", "rlh",
    "vw", "svw", "lvw", "dvw", "vh", "svh", "lvh", "dvh", "vi", "svi", "lvi", "dvi", "vb", "svb", "lvb", "dvb",
    "vmin", "svmin", "lvmin", "dvmin", "vmax", "svmax", "lvmax", "dvmax",
    "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax"
];

const FIXED_UNITS: ReadonlyArray<[string, BaseType, number]> = [
    ["px", "length", 1],
    ["cm", "length", 96 / 2.54],
    ["mm", "length", 96 / 25.4],
    ["q", "length", 96 / 101.6],
    ["in", "length", 96],
    ["pc", "length", 16],
    ["pt", "length", 96 / 72],
    ["deg", "angle", 1],
    ["grad", "angle", 0.9],
    ["rad", "angle", 180 / Math.PI],
    ["turn", "angle", 360],
    ["s", "time", 1],
    ["ms", "time", 0.001],
    ["hz", "frequency", 1],
    ["khz", "frequency", 1000],
    ["dppx", "resolution", 1],
    ["x", "resolution", 1],
    ["dpi", "resolution", 1 / 96],
    ["dpcm", "resolution", 2.54 / 96],
    ["fr", "flex", 1]
];

const CANONICAL_UNITS: Readonly<Record<BaseType, string>> = {
    "length": "px",
    "angle": "deg",
    "time": "s",
    "frequency": "hz",
    "resolution": "dppx",
    "flex": "fr",
    "percent": "%"
};

const UNITS: ReadonlyMap<string, UnitDefinition> = new Map<string, UnitDefinition>([
    ...RELATIVE_LENGTHS.map((unit: string): [string, UnitDefinition] => [unit, { base: "length" }]),
    ...FIXED_UNITS.map(([unit, base, factor]: [string, BaseType, number]): [string, UnitDefinition] => [unit, { base, factor }])
]);

export class CssUnits {

    baseTypeOf(unit: string): BaseType | undefined {
        return UNITS.get(unit)?.base;
    }

    canonicalUnitOf(base: BaseType): string {
        return CANONICAL_UNITS[base];
    }

    toCanonical(value: number, unit: string): number | undefined {
        const factor: number | undefined = UNITS.get(unit)?.factor;
        return factor === undefined ? undefined : value * factor;
    }
}
