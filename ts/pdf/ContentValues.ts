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

import type { CssValue } from "../css/values/CssValue.js";

const IMAGE_FUNCTIONS: ReadonlySet<string> = new Set<string>([
    "src", "image", "image-set", "cross-fade", "linear-gradient", "radial-gradient", "conic-gradient",
    "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient"
]);

export class ContentValues {

    items(value?: CssValue): Array<CssValue> | undefined {
        // CSS Content 3 §1: normal and none give no list; otherwise the list goes up to the slash that starts the alternative text.
        if (value === undefined || (value.kind === "ident" && (value.lower === "normal" || value.lower === "none"))) {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        const slash: number = items.findIndex((item: CssValue) => item.kind === "slash");
        return [...(slash < 0 ? items : items.slice(0, slash))];
    }

    alternative(value?: CssValue): Array<CssValue> | undefined {
        // CSS Content 3 §1.2: "alternative text to be specified after a slash (/) after the last <content-list>".
        if (value === undefined || value.kind !== "list" || value.separator !== "space") {
            return undefined;
        }
        const slash: number = value.items.findIndex((item: CssValue) => item.kind === "slash");
        return slash < 0 ? undefined : value.items.slice(slash + 1);
    }

    isReplacement(items: ReadonlyArray<CssValue>): boolean {
        // CSS Content 3 §1: <content-replacement> is a single <image>, which makes the element or pseudo-element a replaced element.
        return items.length === 1 && this.isImage(items[0]);
    }

    usesContents(items: ReadonlyArray<CssValue>): boolean {
        return items.some((item: CssValue) => item.kind === "ident" && item.lower === "contents");
    }

    isImage(value: CssValue): boolean {
        // CSS Images 4 §2: <image> is a url, image(), image-set(), cross-fade(), element( <id-selector> ) or a gradient; the
        // element() of GCPM 3 takes a name and is a running element instead.
        if (value.kind === "url") {
            return true;
        }
        if (value.kind !== "function") {
            return false;
        }
        return IMAGE_FUNCTIONS.has(value.name) || (value.name === "element" && value.args[0] !== undefined && value.args[0].kind === "hash");
    }
}
