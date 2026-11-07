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

import { RegionScalar } from "../RegionScalar.js";
import type { FontInstance } from "../Typeface.js";
import { AttachmentResolver } from "./AttachmentResolver.js";
import { ExtendedKerningApplier } from "./ExtendedKerningApplier.js";
import type { FontLayout } from "./FontLayout.js";
import type { GlyphInfo } from "./GlyphInfo.js";
import type { AatSetting } from "./MetamorphosisApplier.js";
import { MetamorphosisApplier } from "./MetamorphosisApplier.js";

const SELECTORS: Readonly<Record<string, readonly [number, number, number?]>> = {
    "rlig": [1, 0, 1], "liga": [1, 2, 3], "dlig": [1, 4, 5], "clig": [1, 18, 19], "hlig": [1, 20, 21], "vert": [4, 0, 1], "tnum": [6, 0], "pnum": [6, 1],
    "sups": [10, 1, 0], "subs": [10, 2, 0], "ordn": [10, 3, 0], "sinf": [10, 4, 0], "afrc": [11, 1, 0], "frac": [11, 2, 0], "zero": [14, 4, 5], "titl": [19, 4, 0],
    "trad": [20, 0], "smpl": [20, 1], "jp78": [20, 2], "jp83": [20, 3], "jp90": [20, 4], "expt": [20, 10], "jp04": [20, 11], "hojo": [20, 12], "nlck": [20, 13], "tnam": [20, 14],
    "onum": [21, 0], "lnum": [21, 1], "pwid": [22, 0], "fwid": [22, 1], "hwid": [22, 2], "twid": [22, 3], "qwid": [22, 4], "palt": [22, 5], "halt": [22, 6], "ruby": [28, 2, 3],
    "case": [33, 0, 1], "cpsp": [33, 2, 3], "hkna": [34, 0, 1], "vkna": [34, 2, 3], "calt": [36, 0, 1], "swsh": [36, 2, 3], "cswh": [36, 4, 5], "smcp": [37, 1, 0], "pcap": [37, 2, 0],
    "c2sc": [38, 1, 0], "c2pc": [38, 2, 0]
};
const NUMBERED: Readonly<Record<string, number>> = { "ornm": 16, "salt": 17, "nalt": 24 };
const STYLE_SET: RegExp = /^ss(\d\d)$/;
const STYLISTIC_ALTERNATIVES: number = 35;
const HIGHEST_STYLE_SET: number = 20;

export class AatShaper {

    private readonly layout: FontLayout;
    private readonly attachments: AttachmentResolver = new AttachmentResolver();
    private readonly regionScalar: RegionScalar = new RegionScalar();
    private readonly settings: WeakMap<ReadonlyMap<string, number>, ReadonlyArray<AatSetting>> = new WeakMap<ReadonlyMap<string, number>, ReadonlyArray<AatSetting>>();

    constructor(layout: FontLayout) {
        this.layout = layout;
    }

    substitute(infos: Array<GlyphInfo>, features: ReadonlyMap<string, number>, rtl: boolean, vertical: boolean): void {
        const morx: Buffer = this.layout.typeface.tables["morx"];
        if (morx.length >= 8) {
            new MetamorphosisApplier(morx).apply(infos, this.settingsOf(features), rtl, vertical);
        }
    }

    kern(infos: Array<GlyphInfo>, rtl: boolean, vertical: boolean, instance: FontInstance): void {
        const tables: Readonly<Record<string, Buffer>> = this.layout.typeface.tables;
        if (tables["kerx"].length >= 8) {
            new ExtendedKerningApplier(tables, instance.coordinates, this.tupleScalars(instance.coordinates, tables["gvar"])).apply(infos, vertical);
            this.attachments.resolve(infos, rtl, vertical);
        }
    }

    private settingsOf(features: ReadonlyMap<string, number>): ReadonlyArray<AatSetting> {
        // CSS Fonts 4 §6.1: the OpenType settings "should be used as a guideline to map CSS font feature property values to specific
        // font features" in other formats; aat-font-feature-registry.html gives each as a type and a selector.
        let settings: ReadonlyArray<AatSetting> | undefined = this.settings.get(features);
        if (settings === undefined) {
            const list: Array<AatSetting> = [];
            for (const [tag, value] of features) {
                const selectors: readonly [number, number, number?] | undefined = SELECTORS[tag];
                const style: RegExpExecArray | null = STYLE_SET.exec(tag);
                if (selectors !== undefined) {
                    const selector: number | undefined = value === 0 ? selectors[2] : selectors[1];
                    if (selector !== undefined) {
                        list.push([selectors[0], selector]);
                    }
                } else if (NUMBERED[tag] !== undefined && value !== 0) {
                    list.push([NUMBERED[tag], value]);
                } else if (style !== null && Number(style[1]) >= 1 && Number(style[1]) <= HIGHEST_STYLE_SET) {
                    list.push([STYLISTIC_ALTERNATIVES, Number(style[1]) * 2 + (value === 0 ? 1 : 0)]);
                }
            }
            settings = list;
            this.settings.set(features, settings);
        }
        return settings;
    }

    private tupleScalars(coordinates: Float64Array, gvar?: Buffer): Array<number> {
        // 'kerx', "Variation Font Support": the scalar of each global coordinate of gvar is computed "exactly analogous to the
        // calculations done for the 'gvar' table itself", for a region from zero to the coordinate.
        const scalars: Array<number> = [];
        if (gvar === undefined || gvar.length < 12 || coordinates.every((value: number) => value === 0)) {
            return scalars;
        }
        const axisCount: number = gvar.readUInt16BE(4);
        const count: number = gvar.readUInt16BE(6);
        const offset: number = gvar.readUInt32BE(8);
        for (let index: number = 0; index < count && offset + (index + 1) * axisCount * 2 <= gvar.length; index++) {
            const starts: Float64Array = new Float64Array(axisCount);
            const peaks: Float64Array = new Float64Array(axisCount);
            const ends: Float64Array = new Float64Array(axisCount);
            for (let axis: number = 0; axis < axisCount; axis++) {
                const peak: number = gvar.readInt16BE(offset + (index * axisCount + axis) * 2) / 16384;
                peaks[axis] = peak;
                starts[axis] = Math.min(peak, 0);
                ends[axis] = Math.max(peak, 0);
            }
            scalars.push(this.regionScalar.compute(starts, peaks, ends, coordinates));
        }
        return scalars;
    }
}
