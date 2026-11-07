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

import type { AttributeMatcher, CompiledSelector, CompoundSelector } from "../css/CompiledSelector.js";
import type { StyleRule } from "../css/Stylesheet.js";
import type { SourceElement } from "../parse/SourceElement.js";
import { SelectorMatcher } from "./SelectorMatcher.js";

interface Buckets {
    keyed: Map<string, Array<number>>;
    universal: Array<number>;
}

const NO_PSEUDO_ELEMENT: string = "";

export class RuleIndex {

    private readonly rules: ReadonlyArray<StyleRule>;
    private readonly indexes: Map<string, Buckets> = new Map<string, Buckets>();
    private readonly marks: Uint32Array;
    private readonly matcher: SelectorMatcher;
    private generation: number = 0;

    constructor(rules: ReadonlyArray<StyleRule>, matcher: SelectorMatcher) {
        // A lookup is for an element or for one of its pseudo-elements, so the selectors of each are indexed apart.
        this.rules = rules;
        this.matcher = matcher;
        this.marks = new Uint32Array(rules.length);
        rules.forEach((rule: StyleRule, index: number) => {
            for (const selector of rule.selectors) {
                const name: string = selector.pseudoElement ?? NO_PSEUDO_ELEMENT;
                let buckets: Buckets | undefined = this.indexes.get(name);
                if (buckets === undefined) {
                    buckets = { keyed: new Map<string, Array<number>>(), universal: [] };
                    this.indexes.set(name, buckets);
                }
                const key: string | undefined = this.keyOf(selector);
                if (key === undefined) {
                    buckets.universal.push(index);
                } else {
                    this.add(buckets.keyed, key, index);
                }
            }
        });
    }

    candidates(element: SourceElement, pseudoElement?: string): ReadonlyArray<StyleRule> | undefined {
        // Only rules whose subject compound can match the element; the selector matcher still decides each one.
        const buckets: Buckets | undefined = this.indexes.get(pseudoElement ?? NO_PSEUDO_ELEMENT);
        if (buckets === undefined) {
            return undefined;
        }
        this.generation++;
        const keyed: Map<string, Array<number>> = buckets.keyed;
        let found: Array<StyleRule> | undefined = this.collect(undefined, buckets.universal);
        found = this.collect(found, keyed.get("<" + this.matcher.localName(element)));
        for (const name of SelectorMatcher.ID_ATTRIBUTES) {
            const id: string | undefined = element.getAttributeValue(name);
            if (id !== undefined) {
                found = this.collect(found, keyed.get("#" + id));
            }
        }
        for (const attribute of element.getAttributes()) {
            const name: string = attribute.getName();
            if (name.includes(":") || name === "xmlns") {
                continue;
            }
            const value: string = attribute.getValue();
            found = this.collect(found, keyed.get("[" + name + "=" + value));
            for (const word of value.split(SelectorMatcher.LIST_SEPARATOR)) {
                if (word.length > 0) {
                    found = this.collect(found, keyed.get("[" + name + "~" + word));
                }
            }
        }
        return found;
    }

    private collect(found?: Array<StyleRule>, indexes?: ReadonlyArray<number>): Array<StyleRule> | undefined {
        if (indexes === undefined) {
            return found;
        }
        let rules: Array<StyleRule> | undefined = found;
        for (const index of indexes) {
            if (this.marks[index] !== this.generation) {
                this.marks[index] = this.generation;
                rules = rules ?? [];
                rules.push(this.rules[index]);
            }
        }
        return rules;
    }

    private keyOf(selector: CompiledSelector): string | undefined {
        const compound: CompoundSelector = selector.steps[selector.steps.length - 1].compound;
        if (compound.ids !== undefined) {
            return "#" + compound.ids[0];
        }
        const attribute: AttributeMatcher | undefined = compound.attributes?.find((candidate: AttributeMatcher) =>
            candidate.namespace.kind === "none" && !candidate.caseInsensitive && candidate.value !== undefined && (candidate.operator === "=" || candidate.operator === "~="));
        if (attribute !== undefined) {
            return "[" + attribute.name + (attribute.operator === "=" ? "=" : "~") + attribute.value;
        }
        return compound.type.kind === "localName" ? "<" + compound.type.name : undefined;
    }

    private add(keyed: Map<string, Array<number>>, key: string, index: number): void {
        const bucket: Array<number> | undefined = keyed.get(key);
        if (bucket === undefined) {
            keyed.set(key, [index]);
        } else if (bucket[bucket.length - 1] !== index) {
            bucket.push(index);
        }
    }
}
