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

import type { FontNames } from "./Typeface.js";

interface NameRecord {
    platform: number;
    language: number;
    text: string;
}

const UNICODE_PLATFORM: number = 0;
const MACINTOSH_PLATFORM: number = 1;
const WINDOWS_PLATFORM: number = 3;
const WINDOWS_ENGLISH: number = 0x0409;
const MACINTOSH_ENGLISH: number = 0;
const FAMILY: number = 1;
const FULL_NAME: number = 4;
const POSTSCRIPT_NAME: number = 6;
const TYPOGRAPHIC_FAMILY: number = 16;

export class NameTableReader {

    private readonly records: Map<number, Array<NameRecord>> = new Map<number, Array<NameRecord>>();
    private readonly macRoman: TextDecoder = new TextDecoder("macintosh");
    private readonly utf16: TextDecoder = new TextDecoder("utf-16be");

    constructor(table?: Buffer) {
        if (table === undefined || table.length < 6) {
            return;
        }
        const count: number = table.readUInt16BE(2);
        const storage: number = table.readUInt16BE(4);
        for (let index: number = 0; index < count && 6 + index * 12 + 12 <= table.length; index++) {
            const record: number = 6 + index * 12;
            const platform: number = table.readUInt16BE(record);
            const encoding: number = table.readUInt16BE(record + 2);
            const language: number = table.readUInt16BE(record + 4);
            const identifier: number = table.readUInt16BE(record + 6);
            const length: number = table.readUInt16BE(record + 8);
            const start: number = storage + table.readUInt16BE(record + 10);
            if (start + length > table.length) {
                continue;
            }
            const text: string | undefined = this.decode(platform, encoding, table.subarray(start, start + length));
            if (text === undefined || text.length === 0) {
                continue;
            }
            let list: Array<NameRecord> | undefined = this.records.get(identifier);
            if (list === undefined) {
                list = [];
                this.records.set(identifier, list);
            }
            list.push({ platform, language, text });
        }
    }

    names(): FontNames {
        const families: Array<string> = [];
        for (const identifier of [TYPOGRAPHIC_FAMILY, FAMILY]) {
            const records: ReadonlyArray<{ text: string }> | undefined = this.records.get(identifier);
            if (records === undefined) {
                continue;
            }
            for (const record of records) {
                if (!families.includes(record.text)) {
                    families.push(record.text);
                }
            }
        }
        return {
            families,
            family: this.name(TYPOGRAPHIC_FAMILY) ?? this.name(FAMILY) ?? "",
            fullName: this.name(FULL_NAME) ?? "",
            postScriptName: this.name(POSTSCRIPT_NAME) ?? ""
        };
    }

    name(identifier: number): string | undefined {
        // CSS Fonts 4 §4.3.3.1: the US English name, or the first localization when there is none.
        const list: Array<NameRecord> | undefined = this.records.get(identifier);
        if (list === undefined || list.length === 0) {
            return undefined;
        }
        const english: NameRecord | undefined = list.find((record: NameRecord) =>
            (record.platform === WINDOWS_PLATFORM && record.language === WINDOWS_ENGLISH) || (record.platform === MACINTOSH_PLATFORM && record.language === MACINTOSH_ENGLISH));
        return (english ?? list[0]).text;
    }

    private decode(platform: number, encoding: number, bytes: Buffer): string | undefined {
        if (platform === UNICODE_PLATFORM || (platform === WINDOWS_PLATFORM && (encoding === 0 || encoding === 1 || encoding === 10))) {
            return this.utf16.decode(bytes);
        }
        if (platform === MACINTOSH_PLATFORM && encoding === 0) {
            return this.macRoman.decode(bytes);
        }
        return undefined;
    }
}
