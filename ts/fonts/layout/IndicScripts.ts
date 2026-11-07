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

export interface IndicScript {
    tags: ReadonlyArray<string>;
    halant: number;
    ra: ReadonlyArray<number>;
    reph: number;
    marks: ReadonlyArray<readonly [number, number, number]>;
}

export class IndicScripts {

    static readonly REPH: number = 0;
    static readonly BEFORE_HALF: number = 1;
    static readonly HALF: number = 2;
    static readonly BEFORE_MAIN: number = 3;
    static readonly MAIN: number = 4;
    static readonly AFTER_MAIN: number = 5;
    static readonly BEFORE_SUBSCRIPT: number = 6;
    static readonly SUBSCRIPT: number = 7;
    static readonly AFTER_SUBSCRIPT: number = 8;
    static readonly BEFORE_POSTSCRIPT: number = 9;
    static readonly POSTSCRIPT: number = 10;
    static readonly AFTER_POSTSCRIPT: number = 11;
    static readonly SIGNS: number = 12;

    private static readonly SCRIPTS: ReadonlyArray<IndicScript> = [
        {
            tags: ["dev2", "deva"], halant: 0x094D, ra: [0x0930], reph: IndicScripts.BEFORE_POSTSCRIPT,
            marks: [[0x093F, 0x093F, IndicScripts.BEFORE_HALF], [0x093E, 0x093E, IndicScripts.AFTER_SUBSCRIPT], [0x0940, 0x094C, IndicScripts.AFTER_SUBSCRIPT],
                [0x0962, 0x0963, IndicScripts.AFTER_SUBSCRIPT]]
        },
        {
            tags: ["bng2", "beng"], halant: 0x09CD, ra: [0x09B0, 0x09F0], reph: IndicScripts.AFTER_SUBSCRIPT,
            marks: [[0x09BF, 0x09BF, IndicScripts.BEFORE_HALF], [0x09C7, 0x09C8, IndicScripts.BEFORE_HALF], [0x09C1, 0x09C4, IndicScripts.AFTER_SUBSCRIPT],
                [0x09E2, 0x09E3, IndicScripts.AFTER_SUBSCRIPT], [0x09BE, 0x09BE, IndicScripts.AFTER_POSTSCRIPT], [0x09C0, 0x09C0, IndicScripts.AFTER_POSTSCRIPT],
                [0x09D7, 0x09D7, IndicScripts.AFTER_POSTSCRIPT], [0x0981, 0x0981, IndicScripts.AFTER_POSTSCRIPT]]
        },
        {
            tags: ["gur2", "guru"], halant: 0x0A4D, ra: [0x0A30], reph: IndicScripts.BEFORE_SUBSCRIPT,
            marks: [[0x0A3F, 0x0A3F, IndicScripts.BEFORE_HALF], [0x0A47, 0x0A48, IndicScripts.AFTER_SUBSCRIPT], [0x0A4B, 0x0A4C, IndicScripts.AFTER_SUBSCRIPT],
                [0x0A41, 0x0A42, IndicScripts.AFTER_POSTSCRIPT], [0x0A3E, 0x0A3E, IndicScripts.AFTER_POSTSCRIPT], [0x0A40, 0x0A40, IndicScripts.AFTER_POSTSCRIPT],
                [0x0A01, 0x0A02, IndicScripts.AFTER_POSTSCRIPT], [0x0A70, 0x0A71, IndicScripts.AFTER_POSTSCRIPT]]
        },
        {
            tags: ["gjr2", "gujr"], halant: 0x0ACD, ra: [0x0AB0], reph: IndicScripts.BEFORE_POSTSCRIPT,
            marks: [[0x0ABF, 0x0ABF, IndicScripts.BEFORE_HALF], [0x0AC5, 0x0AC5, IndicScripts.AFTER_SUBSCRIPT], [0x0AC7, 0x0AC8, IndicScripts.AFTER_SUBSCRIPT],
                [0x0AC1, 0x0AC4, IndicScripts.AFTER_POSTSCRIPT], [0x0AE2, 0x0AE3, IndicScripts.AFTER_POSTSCRIPT], [0x0ABE, 0x0ABE, IndicScripts.AFTER_POSTSCRIPT],
                [0x0AC0, 0x0AC0, IndicScripts.AFTER_POSTSCRIPT], [0x0AC9, 0x0AC9, IndicScripts.AFTER_POSTSCRIPT], [0x0ACB, 0x0ACC, IndicScripts.AFTER_POSTSCRIPT]]
        },
        {
            tags: ["ory2", "orya"], halant: 0x0B4D, ra: [0x0B30], reph: IndicScripts.AFTER_MAIN,
            marks: [[0x0B47, 0x0B47, IndicScripts.BEFORE_HALF], [0x0B3F, 0x0B3F, IndicScripts.AFTER_MAIN], [0x0B56, 0x0B56, IndicScripts.AFTER_MAIN],
                [0x0B41, 0x0B43, IndicScripts.AFTER_SUBSCRIPT], [0x0B3E, 0x0B3E, IndicScripts.AFTER_POSTSCRIPT], [0x0B40, 0x0B40, IndicScripts.AFTER_POSTSCRIPT],
                [0x0B57, 0x0B57, IndicScripts.AFTER_POSTSCRIPT], [0x0B01, 0x0B01, IndicScripts.BEFORE_SUBSCRIPT]]
        },
        {
            tags: ["tml2", "taml"], halant: 0x0BCD, ra: [0x0BB0], reph: IndicScripts.AFTER_POSTSCRIPT,
            marks: [[0x0BC6, 0x0BC8, IndicScripts.BEFORE_MAIN], [0x0BC0, 0x0BC0, IndicScripts.AFTER_SUBSCRIPT], [0x0BBF, 0x0BBF, IndicScripts.AFTER_POSTSCRIPT],
                [0x0BC1, 0x0BC2, IndicScripts.AFTER_POSTSCRIPT], [0x0BBE, 0x0BBE, IndicScripts.AFTER_POSTSCRIPT], [0x0BD7, 0x0BD7, IndicScripts.AFTER_POSTSCRIPT]]
        },
        {
            tags: ["tel2", "telu"], halant: 0x0C4D, ra: [0x0C30], reph: IndicScripts.AFTER_POSTSCRIPT,
            marks: [[0x0C3E, 0x0C42, IndicScripts.BEFORE_SUBSCRIPT], [0x0C46, 0x0C47, IndicScripts.BEFORE_SUBSCRIPT], [0x0C4A, 0x0C4C, IndicScripts.BEFORE_SUBSCRIPT],
                [0x0C55, 0x0C56, IndicScripts.BEFORE_SUBSCRIPT], [0x0C43, 0x0C44, IndicScripts.AFTER_SUBSCRIPT]]
        },
        {
            tags: ["knd2", "knda"], halant: 0x0CCD, ra: [0x0CB0], reph: IndicScripts.AFTER_POSTSCRIPT,
            marks: [[0x0CBE, 0x0CBF, IndicScripts.BEFORE_SUBSCRIPT], [0x0CC6, 0x0CC6, IndicScripts.BEFORE_SUBSCRIPT], [0x0CCC, 0x0CCC, IndicScripts.BEFORE_SUBSCRIPT],
                [0x0CE2, 0x0CE3, IndicScripts.BEFORE_SUBSCRIPT], [0x0CC1, 0x0CC2, IndicScripts.BEFORE_SUBSCRIPT], [0x0CC3, 0x0CC4, IndicScripts.AFTER_SUBSCRIPT],
                [0x0CD5, 0x0CD6, IndicScripts.AFTER_SUBSCRIPT]]
        },
        {
            tags: ["mlm2", "mlym"], halant: 0x0D4D, ra: [0x0D30], reph: IndicScripts.AFTER_MAIN,
            marks: [[0x0D46, 0x0D48, IndicScripts.BEFORE_MAIN], [0x0D3E, 0x0D43, IndicScripts.AFTER_POSTSCRIPT], [0x0D57, 0x0D57, IndicScripts.AFTER_POSTSCRIPT]]
        }
    ];

    static readonly TAGS: ReadonlySet<string> = new Set<string>(IndicScripts.SCRIPTS.flatMap((script: IndicScript) => script.tags));

    scriptOf(tags: ReadonlyArray<string>): IndicScript | undefined {
        return IndicScripts.SCRIPTS.find((script: IndicScript) => script.tags.some((tag: string) => tags.includes(tag)));
    }

    positionOf(script: IndicScript, code: number): number {
        // Indic shaping engine, "Character reordering Classes": the class of each matra and sign of the script; a matra the
        // table of its script does not list goes after the subjoined consonants.
        for (const [first, last, position] of script.marks) {
            if (code >= first && code <= last) {
                return position;
            }
        }
        return IndicScripts.AFTER_SUBSCRIPT;
    }
}
