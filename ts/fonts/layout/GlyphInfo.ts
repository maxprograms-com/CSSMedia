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

export const ATTACH_MARK: number = 1;
export const ATTACH_CURSIVE: number = 2;

export interface GlyphInfo {
    glyph: number;
    cluster: number;
    codepoint: number;
    mask: number;
    xAdvance: number;
    xOffset: number;
    yOffset: number;
    glyphClass: number;
    ligatureId: number;
    ligatureComponent: number;
    ligatureComponents: number;
    attachment: number;
    attachmentKind: number;
    ignorable: boolean;
    joiner: boolean;
    nonJoiner: boolean;
    category: number;
    substituted: boolean;
}
