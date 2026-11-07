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

import { InstanceBuilder } from "./InstanceBuilder.js";
import type { BaseCoordinate, BaselineAxis, FontBaselines, ItemVariationStore, ScriptBaselines } from "./Typeface.js";
import type { VariationReader } from "./VariationReader.js";

const VARIATION_INDEX: number = 0x8000;

export class BaselineReader {

    read(variations: VariationReader, base?: Buffer): FontBaselines {
        if (base === undefined || base.length < 8 || base.readUInt16BE(0) !== 1) {
            return {};
        }
        const horizontal: number = base.readUInt16BE(4);
        const vertical: number = base.readUInt16BE(6);
        const storeOffset: number = base.readUInt16BE(2) >= 1 && base.length >= 12 ? base.readUInt32BE(8) : 0;
        const store: ItemVariationStore | undefined = storeOffset === 0 ? undefined : variations.store(base, storeOffset);
        const baselines: FontBaselines = {};
        if (horizontal !== 0) {
            baselines.horizontal = this.axis(base, horizontal);
        }
        if (vertical !== 0) {
            baselines.vertical = this.axis(base, vertical);
        }
        if (store !== undefined) {
            baselines.store = store;
        }
        return baselines;
    }

    private axis(base: Buffer, offset: number): BaselineAxis {
        const tagList: number = base.readUInt16BE(offset);
        const scriptList: number = offset + base.readUInt16BE(offset + 2);
        const tags: Array<string> = [];
        if (tagList !== 0) {
            const count: number = base.readUInt16BE(offset + tagList);
            for (let index: number = 0; index < count; index++) {
                const position: number = offset + tagList + 2 + index * 4;
                tags.push(base.toString("latin1", position, position + 4));
            }
        }
        const scripts: Array<ScriptBaselines> = [];
        const count: number = base.readUInt16BE(scriptList);
        for (let index: number = 0; index < count; index++) {
            const record: number = scriptList + 2 + index * 6;
            const script: string = base.toString("latin1", record, record + 4);
            const scriptTable: number = scriptList + base.readUInt16BE(record + 4);
            const valuesOffset: number = base.readUInt16BE(scriptTable);
            if (valuesOffset === 0) {
                continue;
            }
            const values: number = scriptTable + valuesOffset;
            const defaultIndex: number = base.readUInt16BE(values);
            const coordinateCount: number = base.readUInt16BE(values + 2);
            const coordinates: Record<string, BaseCoordinate> = {};
            for (let coordinate: number = 0; coordinate < coordinateCount && coordinate < tags.length; coordinate++) {
                coordinates[tags[coordinate]] = this.coordinate(base, values + base.readUInt16BE(values + 4 + coordinate * 2));
            }
            scripts.push({ script, defaultBaseline: tags[defaultIndex] ?? "", coordinates });
        }
        return { scripts };
    }

    private coordinate(base: Buffer, offset: number): BaseCoordinate {
        // OpenType BASE, BaseCoord format 3: the device offset may point to a VariationIndex table instead.
        const format: number = base.readUInt16BE(offset);
        const value: number = base.readInt16BE(offset + 2);
        if (format === 3) {
            const device: number = base.readUInt16BE(offset + 4);
            if (device !== 0 && base.readUInt16BE(offset + device + 4) === VARIATION_INDEX) {
                return { value, outer: base.readUInt16BE(offset + device), inner: base.readUInt16BE(offset + device + 2) };
            }
        }
        return { value, outer: InstanceBuilder.NO_VARIATION, inner: InstanceBuilder.NO_VARIATION };
    }
}
