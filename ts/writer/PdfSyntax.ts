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

const DELIMITERS: string = "()<>[]{}/%#";
const DECIMALS: number = 4;
const SIGNIFICANT: number = 5;
const MAX_DECIMALS: number = 10;
const SAFE_INTEGER: number = 1e15;

export class PdfSyntax {

    number(value: number): string {
        // ISO 32000-2 §7.3.3: "A PDF writer shall not use the PostScript language syntax for numbers with non-decimal
        // radices", "or in exponential format".
        if (!Number.isFinite(value)) {
            return "0";
        }
        // Four decimals place a point closely enough; a value below one, such as the scale of a matrix that maps a form to
        // the unit square, keeps five significant digits, since an error in it grows with what it scales.
        const magnitude: number = Math.abs(value);
        const decimals: number = magnitude >= 1 || magnitude === 0 ? DECIMALS
            : Math.min(MAX_DECIMALS, Math.max(DECIMALS, SIGNIFICANT - 1 - Math.floor(Math.log10(magnitude))));
        const factor: number = Math.pow(10, decimals);
        const rounded: number = Math.round(value * factor) / factor;
        if (Number.isInteger(rounded)) {
            if (rounded === 0) {
                return "0";
            }
            return Math.abs(rounded) < SAFE_INTEGER ? String(rounded) : BigInt(rounded).toString();
        }
        return rounded.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
    }

    numbers(values: ArrayLike<number>): string {
        let text: string = "";
        for (let index: number = 0; index < values.length; index++) {
            text += (index === 0 ? "" : " ") + this.number(values[index]);
        }
        return text;
    }

    name(text: string): string {
        // §7.3.5: the bytes of the name in UTF-8; a character that is not regular, white space included, and the number
        // sign are written as two hexadecimal digits after a number sign.
        let result: string = "/";
        for (const byte of Buffer.from(text, "utf8")) {
            const regular: boolean = byte > 0x20 && byte < 0x7F && !DELIMITERS.includes(String.fromCharCode(byte));
            result += regular ? String.fromCharCode(byte) : "#" + byte.toString(16).toUpperCase().padStart(2, "0");
        }
        return result;
    }

    literal(text: string): string {
        // §7.3.4.2: the reverse solidus and the parentheses are escaped, and so are the end-of-line characters, which a
        // reader would otherwise turn into a line feed.
        return "(" + text.replace(/[\\()]/g, "\\$&").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + ")";
    }

    hex(bytes: Uint8Array): string {
        return "<" + Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex").toUpperCase() + ">";
    }

    textString(text: string): string {
        // §7.9.2.2: printable ASCII is the same in PDFDocEncoding; anything else is UTF-16BE after its byte order marker.
        if (/^[\x20-\x7E]*$/.test(text)) {
            return this.literal(text);
        }
        const encoded: Buffer = Buffer.from(text, "utf16le").swap16();
        return this.hex(Buffer.concat([Buffer.from([0xFE, 0xFF]), encoded]));
    }

    asciiString(text: string): string {
        // §12.6.4.8: a URI is "encoded in UTF-8" in an ASCII string, so the bytes outside ASCII are written as octal escapes.
        let result: string = "(";
        for (const byte of Buffer.from(text, "utf8")) {
            if (byte === 0x5C || byte === 0x28 || byte === 0x29) {
                result += "\\" + String.fromCharCode(byte);
            } else if (byte < 0x20 || byte > 0x7E) {
                result += "\\" + byte.toString(8).padStart(3, "0");
            } else {
                result += String.fromCharCode(byte);
            }
        }
        return result + ")";
    }

    reference(object: number): string {
        return object + " 0 R";
    }
}
