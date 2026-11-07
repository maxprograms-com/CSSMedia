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

import { ClassDefinition } from "./ClassDefinition.js";
import { Coverage } from "./Coverage.js";

const NO_REQUIRED_FEATURE: number = 0xFFFF;
const GSUB_EXTENSION: number = 7;
const GPOS_EXTENSION: number = 9;
const USE_MARK_FILTERING_SET: number = 0x0010;

export interface FeatureRecord {
    tag: string;
    lookups: ReadonlyArray<number>;
}

export interface LanguageSystem {
    scriptTag: string;
    languageTag: string;
    requiredFeature?: number;
    features: ReadonlyArray<number>;
}

export interface LookupHeader {
    type: number;
    flag: number;
    markFilteringSet?: number;
    subtables: ReadonlyArray<number>;
}

interface ScriptRecord {
    defaultLanguage?: number;
    languages: Map<string, number>;
}

export class LayoutTable {

    readonly buffer: Buffer;
    readonly features: Array<FeatureRecord> = [];
    private readonly isPositioning: boolean;
    private readonly scripts: Map<string, ScriptRecord> = new Map<string, ScriptRecord>();
    private readonly lookupOffsets: Array<number> = [];
    private readonly lookupHeaders: Map<number, LookupHeader> = new Map<number, LookupHeader>();
    private readonly coverages: Map<number, Coverage> = new Map<number, Coverage>();
    private readonly classDefinitions: Map<number, ClassDefinition> = new Map<number, ClassDefinition>();
    private readonly parsedSubtables: Map<number, unknown> = new Map<number, unknown>();
    private readonly featureVariations: number;

    constructor(buffer: Buffer, isPositioning: boolean) {
        // OpenType GSUB and GPOS headers: version 1.1 adds the offset of the FeatureVariations table.
        this.buffer = buffer;
        this.isPositioning = isPositioning;
        const scriptListOffset: number = buffer.readUInt16BE(4);
        const featureListOffset: number = buffer.readUInt16BE(6);
        const lookupListOffset: number = buffer.readUInt16BE(8);
        this.featureVariations = buffer.readUInt16BE(0) === 1 && buffer.readUInt16BE(2) >= 1 ? buffer.readUInt32BE(10) : 0;
        this.readScripts(scriptListOffset);
        this.readFeatures(featureListOffset);
        const lookupCount: number = buffer.readUInt16BE(lookupListOffset);
        for (let index: number = 0; index < lookupCount; index++) {
            this.lookupOffsets.push(lookupListOffset + buffer.readUInt16BE(lookupListOffset + 2 + index * 2));
        }
    }

    hasScript(scriptTags: ReadonlyArray<string>): boolean {
        return scriptTags.some((tag: string) => this.scripts.has(tag));
    }

    languageSystemOf(scriptTags: ReadonlyArray<string>, languageTags?: ReadonlyArray<string>): LanguageSystem | undefined {
        for (const scriptTag of scriptTags) {
            const script: ScriptRecord | undefined = this.scripts.get(scriptTag);
            if (script === undefined) {
                continue;
            }
            if (languageTags !== undefined) {
                for (const languageTag of languageTags) {
                    const offset: number | undefined = script.languages.get(languageTag);
                    if (offset !== undefined) {
                        return this.readLanguageSystem(offset, scriptTag, languageTag);
                    }
                }
            }
            if (script.defaultLanguage !== undefined) {
                return this.readLanguageSystem(script.defaultLanguage, scriptTag, "dflt");
            }
        }
        return undefined;
    }

    featuresFor(coordinates: Float64Array): ReadonlyArray<FeatureRecord> {
        // OpenType common formats, "FeatureVariations table": the first record whose condition set matches the instance
        // replaces the feature tables its substitution table lists; an alternate keeps the tag of the default table.
        if (this.featureVariations === 0 || this.buffer.readUInt16BE(this.featureVariations) !== 1) {
            return this.features;
        }
        const count: number = this.buffer.readUInt32BE(this.featureVariations + 4);
        for (let index: number = 0; index < count; index++) {
            const record: number = this.featureVariations + 8 + index * 8;
            const conditionSet: number = this.buffer.readUInt32BE(record);
            const substitution: number = this.buffer.readUInt32BE(record + 4);
            if (conditionSet !== 0 && !this.conditionsHold(this.featureVariations + conditionSet, coordinates)) {
                continue;
            }
            if (substitution === 0) {
                return this.features;
            }
            const table: number = this.featureVariations + substitution;
            if (this.buffer.readUInt16BE(table) !== 1) {
                continue;
            }
            return this.substituted(table);
        }
        return this.features;
    }

    lookupHeaderAt(index: number): LookupHeader | undefined {
        let header: LookupHeader | undefined = this.lookupHeaders.get(index);
        if (header === undefined && index >= 0 && index < this.lookupOffsets.length) {
            header = this.readLookupHeader(this.lookupOffsets[index]);
            this.lookupHeaders.set(index, header);
        }
        return header;
    }

    coverageAt(offset: number): Coverage {
        let coverage: Coverage | undefined = this.coverages.get(offset);
        if (coverage === undefined) {
            coverage = new Coverage(this.buffer, offset);
            this.coverages.set(offset, coverage);
        }
        return coverage;
    }

    classDefinitionAt(offset: number): ClassDefinition {
        let definition: ClassDefinition | undefined = this.classDefinitions.get(offset);
        if (definition === undefined) {
            definition = new ClassDefinition(this.buffer, offset);
            this.classDefinitions.set(offset, definition);
        }
        return definition;
    }

    subtableAt<T>(offset: number, parse: (offset: number) => T): T {
        let parsed: unknown = this.parsedSubtables.get(offset);
        if (parsed === undefined) {
            parsed = parse(offset);
            this.parsedSubtables.set(offset, parsed);
        }
        return parsed as T;
    }

    private conditionsHold(conditionSet: number, coordinates: Float64Array): boolean {
        // "If a layout engine encounters a condition table with an unrecognized format, it should fail to match the condition
        // set"; an axis index outside the font's axes makes the record ignored.
        const count: number = this.buffer.readUInt16BE(conditionSet);
        for (let index: number = 0; index < count; index++) {
            const condition: number = conditionSet + this.buffer.readUInt32BE(conditionSet + 2 + index * 4);
            const axis: number = this.buffer.readUInt16BE(condition + 2);
            if (this.buffer.readUInt16BE(condition) !== 1 || axis >= coordinates.length) {
                return false;
            }
            const value: number = coordinates[axis];
            if (value < this.buffer.readInt16BE(condition + 4) / 16384 || value > this.buffer.readInt16BE(condition + 6) / 16384) {
                return false;
            }
        }
        return true;
    }

    private substituted(table: number): Array<FeatureRecord> {
        const features: Array<FeatureRecord> = [...this.features];
        const count: number = this.buffer.readUInt16BE(table + 4);
        for (let index: number = 0; index < count; index++) {
            const record: number = table + 6 + index * 6;
            const featureIndex: number = this.buffer.readUInt16BE(record);
            const original: FeatureRecord | undefined = features[featureIndex];
            if (original !== undefined) {
                features[featureIndex] = { tag: original.tag, lookups: this.readLookupIndexes(table + this.buffer.readUInt32BE(record + 2)) };
            }
        }
        return features;
    }

    private readScripts(list: number): void {
        const count: number = this.buffer.readUInt16BE(list);
        for (let index: number = 0; index < count; index++) {
            const record: number = list + 2 + index * 6;
            const tag: string = this.buffer.toString("latin1", record, record + 4);
            const script: number = list + this.buffer.readUInt16BE(record + 4);
            const defaultOffset: number = this.buffer.readUInt16BE(script);
            const languageCount: number = this.buffer.readUInt16BE(script + 2);
            const languages: Map<string, number> = new Map<string, number>();
            for (let language: number = 0; language < languageCount; language++) {
                const languageRecord: number = script + 4 + language * 6;
                languages.set(this.buffer.toString("latin1", languageRecord, languageRecord + 4), script + this.buffer.readUInt16BE(languageRecord + 4));
            }
            this.scripts.set(tag, defaultOffset === 0 ? { languages } : { defaultLanguage: script + defaultOffset, languages });
        }
    }

    private readFeatures(list: number): void {
        const count: number = this.buffer.readUInt16BE(list);
        for (let index: number = 0; index < count; index++) {
            const record: number = list + 2 + index * 6;
            const tag: string = this.buffer.toString("latin1", record, record + 4);
            this.features.push({ tag, lookups: this.readLookupIndexes(list + this.buffer.readUInt16BE(record + 4)) });
        }
    }

    private readLookupIndexes(feature: number): Array<number> {
        const lookupCount: number = this.buffer.readUInt16BE(feature + 2);
        const lookups: Array<number> = [];
        for (let lookup: number = 0; lookup < lookupCount; lookup++) {
            lookups.push(this.buffer.readUInt16BE(feature + 4 + lookup * 2));
        }
        return lookups;
    }

    private readLanguageSystem(offset: number, scriptTag: string, languageTag: string): LanguageSystem {
        const required: number = this.buffer.readUInt16BE(offset + 2);
        const count: number = this.buffer.readUInt16BE(offset + 4);
        const features: Array<number> = [];
        for (let index: number = 0; index < count; index++) {
            features.push(this.buffer.readUInt16BE(offset + 6 + index * 2));
        }
        return required === NO_REQUIRED_FEATURE ? { scriptTag, languageTag, features } : { scriptTag, languageTag, requiredFeature: required, features };
    }

    private readLookupHeader(offset: number): LookupHeader {
        // OpenType GSUB type 7 and GPOS type 9: an extension subtable gives the real lookup type and a 32-bit offset.
        let type: number = this.buffer.readUInt16BE(offset);
        const flag: number = this.buffer.readUInt16BE(offset + 2);
        const count: number = this.buffer.readUInt16BE(offset + 4);
        let subtables: Array<number> = [];
        for (let index: number = 0; index < count; index++) {
            subtables.push(offset + this.buffer.readUInt16BE(offset + 6 + index * 2));
        }
        const markFilteringSet: number | undefined = (flag & USE_MARK_FILTERING_SET) !== 0 ? this.buffer.readUInt16BE(offset + 6 + count * 2) : undefined;
        if (type === (this.isPositioning ? GPOS_EXTENSION : GSUB_EXTENSION) && subtables.length > 0) {
            const resolved: Array<number> = [];
            for (const subtable of subtables) {
                type = this.buffer.readUInt16BE(subtable + 2);
                resolved.push(subtable + this.buffer.readUInt32BE(subtable + 4));
            }
            subtables = resolved;
        }
        return markFilteringSet === undefined ? { type, flag, subtables } : { type, flag, markFilteringSet, subtables };
    }
}
