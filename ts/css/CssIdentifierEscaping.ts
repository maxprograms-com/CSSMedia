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

const NEWLINE_PREPROCESSING: RegExp = /\r\n|\r|\f/g;

const TRAILING_ESCAPE_WHITESPACE: RegExp = /^(?:\r\n|[ \t\n\r\f])/;

export class CssIdentifierEscaping {

    unescape(raw: string): string {
        if (!raw.includes("\\")) {
            return raw;
        }
        const normalized: string = raw.replace(NEWLINE_PREPROCESSING, "\n");
        let result: string = "";
        for (let index: number = 0; index < normalized.length; index++) {
            const character: string = normalized[index];
            if (character !== "\\") {
                result += character;
                continue;
            }
            index++;
            if (index >= normalized.length) {
                // CSS Syntax 3 §4.3.7: end of input after a backslash gives U+FFFD.
                result += String.fromCodePoint(0xFFFD);
                break;
            }
            if (normalized[index] === "\n") {
                // CSS Syntax 3 §4.3.8: a backslash before a newline is not an escape, so both stay what they are.
                result += "\\\n";
                continue;
            }
            const hexMatch: RegExpExecArray | null = /^[0-9a-fA-F]{1,6}/.exec(normalized.slice(index));
            if (hexMatch) {
                const codePoint: number = Number.parseInt(hexMatch[0], 16);
                result += String.fromCodePoint(this.isInvalidUnicodeScalarValue(codePoint) ? 0xFFFD : codePoint);
                index += hexMatch[0].length - 1;
                const next: string | undefined = normalized[index + 1];
                if (next === " " || next === "\t" || next === "\n") {
                    index++;
                }
            } else {
                result += normalized[index];
            }
        }
        return result;
    }

    canonical(raw: string): string {
        // CSSOM, "serialize an identifier": the same name written with the escapes that its characters need and no others.
        if (!raw.includes("\\")) {
            return raw;
        }
        let result: string = "";
        let index: number = 0;
        let first: number = 0;
        for (const character of this.unescape(raw)) {
            const code: number = character.codePointAt(0) as number;
            const digit: boolean = code >= 0x30 && code <= 0x39;
            if (code === 0) {
                result += String.fromCodePoint(0xFFFD);
            } else if (code <= 0x1F || code === 0x7F || (digit && (index === 0 || (index === 1 && first === 0x2D)))) {
                result += "\\" + code.toString(16) + " ";
            } else if (code >= 0x80 || digit || code === 0x2D || code === 0x5F || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
                result += character;
            } else {
                result += "\\" + character;
            }
            first = index === 0 ? code : first;
            index++;
        }
        return index === 1 && first === 0x2D ? "\\-" : result;
    }

    rawPipeIndex(raw: string): number {
        // An escaped "|" (e.g. "x\00007Ctest") is identifier data, not the namespace-prefix delimiter.
        for (let index: number = 0; index < raw.length; index++) {
            const character: string = raw[index];
            if (character === "\\") {
                index++;
                if (index >= raw.length) {
                    break;
                }
                const hexMatch: RegExpExecArray | null = /^[0-9a-fA-F]{1,6}/.exec(raw.slice(index));
                if (hexMatch) {
                    index += hexMatch[0].length - 1;
                    const trailingMatch: RegExpExecArray | null = TRAILING_ESCAPE_WHITESPACE.exec(raw.slice(index + 1));
                    if (trailingMatch) {
                        index += trailingMatch[0].length;
                    }
                }
                continue;
            }
            if (character === "|") {
                return index;
            }
        }
        return -1;
    }

    isUniversalType(rawName: string): boolean {
        // The universal selector contributes zero to specificity in every namespace form ("*", "*|*", "ns|*", "|*").
        const pipeIndex: number = this.rawPipeIndex(rawName);
        const rawLocalName: string = pipeIndex === -1 ? rawName : rawName.slice(pipeIndex + 1);
        return this.unescape(rawLocalName) === "*";
    }

    private isInvalidUnicodeScalarValue(codePoint: number): boolean {
        return codePoint === 0 || (codePoint >= 0xD800 && codePoint <= 0xDFFF) || codePoint > 0x10FFFF;
    }
}
