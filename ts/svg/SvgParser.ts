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

import type { XMLDocument } from "typesxml";
import { DOMBuilder } from "typesxml";
import type { ImageReader } from "../images/ImageFormats.js";
import { XmlTreeBuilder } from "../parse/XmlTreeBuilder.js";

export class SvgParser {

    parse(read: ImageReader, url: string): XMLDocument {
        const builder: DOMBuilder = new DOMBuilder();
        new XmlTreeBuilder().parseImage(builder, read, url);
        const document: XMLDocument | undefined = builder.getDocument();
        if (document === undefined || document.getRoot() === undefined) {
            throw new Error("The SVG image " + url + " has no root element");
        }
        return document;
    }
}
