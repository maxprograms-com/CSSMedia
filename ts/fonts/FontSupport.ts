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

const FORMATS: ReadonlySet<string> = new Set<string>(["collection", "opentype", "truetype", "woff", "woff2"]);
const TECHNOLOGIES: ReadonlySet<string> = new Set<string>(["features-opentype", "features-aat", "variations", "avar2"]);

export class FontSupport {

    format(format: string): boolean {
        // embedded-opentype and svg are not supported: only retired browsers used the first, and SVG 2 removed SVG fonts.
        // CSS Fonts 4 §4.3 has a source in an unsupported format skipped, so the next source of the rule is used.
        return FORMATS.has(format);
    }

    technology(technology: string): boolean {
        // features-graphite, the color font technologies, palettes and incremental are not supported: none of them is needed
        // to size or place text, and CSS Fonts 4 §4.3 has a source that requires an unsupported technology skipped.
        return TECHNOLOGIES.has(technology);
    }
}
