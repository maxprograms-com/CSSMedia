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

import { PropertyTable } from "../css/PropertyTable.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { Cascade } from "./Cascade.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { StyleComputer } from "./StyleComputer.js";

export class LanguageResolver {

    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly styles: WeakMap<SourceElement, ComputedStyle> = new WeakMap<SourceElement, ComputedStyle>();
    private readonly languages: WeakMap<SourceElement, string | null> = new WeakMap<SourceElement, string | null>();

    constructor(cascade: Cascade, computer: StyleComputer) {
        this.cascade = cascade;
        this.computer = computer;
    }

    languageOf(element: SourceElement): string | undefined {
        let language: string | null | undefined = this.languages.get(element);
        if (language === undefined) {
            language = this.resolve(element);
            this.languages.set(element, language);
        }
        return language ?? undefined;
    }

    private resolve(element: SourceElement): string | null {
        // attr() gives an empty string for a missing attribute, which must not erase the language.
        const value: CssValue | undefined = this.style(element).values[PropertyTable.LANGUAGE];
        if (value !== undefined && value.kind === "string" && value.value.length > 0) {
            return value.value;
        }
        if (element.getAttributeValue("xml:lang") !== undefined) {
            return element.getLanguage() ?? null;
        }
        const parent: SourceElement | undefined = element.getParent();
        return parent === undefined ? null : this.languageOf(parent) ?? null;
    }

    private style(element: SourceElement): ComputedStyle {
        let style: ComputedStyle | undefined = this.styles.get(element);
        if (style === undefined) {
            const parent: SourceElement | undefined = element.getParent();
            style = this.computer.compute(StyleComputer.input(this.cascade.languageDeclarations(element), { width: 0, height: 0 }, StyleComputer.NO_CONTAINERS,
                parent === undefined ? undefined : this.style(parent), undefined, element));
            this.styles.set(element, style);
        }
        return style;
    }
}
