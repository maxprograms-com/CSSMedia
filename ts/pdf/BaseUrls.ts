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

import type { SourceElement } from "../parse/SourceElement.js";

const PERCENT: number = 0x25;

export class BaseUrls {

    private readonly documentUri: string;

    constructor(documentUri: string) {
        this.documentUri = documentUri;
    }

    static percentDecoded(text: string): Buffer {
        // URL Standard §1.3: a "%" not followed by two hexadecimal digits stays as it is, so no text fails to decode.
        const bytes: Buffer = Buffer.from(text, "utf8");
        if (!bytes.includes(PERCENT)) {
            return bytes;
        }
        const output: Buffer = Buffer.alloc(bytes.length);
        let length: number = 0;
        for (let index: number = 0; index < bytes.length; index++) {
            const high: number = bytes[index] === PERCENT ? BaseUrls.hexDigit(bytes[index + 1]) : -1;
            const low: number = high < 0 ? -1 : BaseUrls.hexDigit(bytes[index + 2]);
            if (low < 0) {
                output[length++] = bytes[index];
            } else {
                output[length++] = high * 16 + low;
                index += 2;
            }
        }
        return output.subarray(0, length);
    }

    private static hexDigit(byte: number | undefined): number {
        if (byte === undefined) {
            return -1;
        }
        if (byte >= 0x30 && byte <= 0x39) {
            return byte - 0x30;
        }
        if (byte >= 0x41 && byte <= 0x46) {
            return byte - 0x37;
        }
        return byte >= 0x61 && byte <= 0x66 ? byte - 0x57 : -1;
    }

    of(element?: SourceElement): string {
        // An element has a base only when it or an ancestor declares xml:base, and a relative one adds to the document's address.
        const declared: string | undefined = element?.getBase();
        if (declared === undefined) {
            return this.documentUri;
        }
        return URL.canParse(declared, this.documentUri) ? new URL(declared, this.documentUri).href : declared;
    }

    resolve(reference: string, element?: SourceElement): string | undefined {
        return BaseUrls.resolved(reference, this.of(element));
    }

    static resolved(reference: string, base: string): string | undefined {
        if (URL.canParse(base)) {
            return URL.canParse(reference, base) ? new URL(reference, base).href : undefined;
        }
        if (!URL.canParse(reference)) {
            throw new Error("Invalid xml:base \"" + base + "\"");
        }
        return new URL(reference).href;
    }
}
