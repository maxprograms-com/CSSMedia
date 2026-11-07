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
import type { BoxNode, ElementBox } from "./BoxTree.js";

interface RubyPair {
    annotation: ElementBox;
    bases?: ReadonlyArray<ElementBox>;
}

export class RubyPairing {

    baseContainerOf(ruby: ElementBox, index: number): ElementBox | undefined {
        // CSS Ruby 1 §2.3.1: a segment is "a single ruby base container followed by one or more ruby annotation containers";
        // for an annotation container that follows none, "an anonymous, empty ruby base container is assumed".
        for (let before: number = index - 1; before >= 0; before--) {
            const node: BoxNode = ruby.children[before];
            if (node.kind !== "box" || node.placement !== "in-flow") {
                continue;
            }
            if (node.display.internal !== "ruby-text-container") {
                return node.display.internal === "ruby-base-container" ? node : undefined;
            }
        }
        return undefined;
    }

    pairs(annotationContainer: ElementBox, baseContainer?: ElementBox): Array<RubyPair> {
        const row: Array<ElementBox> | undefined = baseContainer === undefined ? undefined : this.levelBoxes(baseContainer);
        const annotations: Array<ElementBox> = this.levelBoxes(annotationContainer);
        // CSS Ruby 1 §2.3.2: "If a ruby annotation container contains only a single, anonymous ruby annotation, then that ruby
        // annotation is paired with (i.e. spans across) all of the ruby bases in its ruby segment", white space included.
        if (annotations.length === 1 && annotations[0].element === undefined) {
            return [row === undefined || row.length === 0 ? { annotation: annotations[0] } : { annotation: annotations[0], bases: row }];
        }
        // "Otherwise, each ruby annotation is paired, in document order, with the corresponding ruby base in that segment";
        // "Intra-level white space does not participate in standard annotation pairing."
        const bases: Array<ElementBox> | undefined = row?.filter((box: ElementBox) => box.rubyWhiteSpace === undefined);
        const pairs: Array<RubyPair> = [];
        for (const annotation of annotations) {
            if (annotation.rubyWhiteSpace === undefined) {
                pairs.push(bases !== undefined && pairs.length < bases.length ? { annotation, bases: [bases[pairs.length]] } : { annotation });
            }
        }
        return pairs;
    }

    isHidden(pair: RubyPair, annotationContainer: ElementBox): boolean {
        // CSS Ruby 1 §2.4: an annotation "whose visibility is collapse", or one that "has the exact same text content as its
        // base", is hidden; "When the computed value of ruby-merge on the annotation container is merge, hiding is disabled."
        if (this.keyword(annotationContainer.style.values["ruby-merge"]) === "merge") {
            return false;
        }
        if (this.keyword(pair.annotation.style.values["visibility"]) === "collapse") {
            return true;
        }
        let base: string = "";
        if (pair.bases !== undefined) {
            for (const box of pair.bases) {
                base += this.textOf(box);
            }
        }
        return this.textOf(pair.annotation) === base;
    }

    private levelBoxes(container: ElementBox): Array<ElementBox> {
        return container.children.filter((node: BoxNode): node is ElementBox =>
            node.kind === "box" && node.placement === "in-flow" && (node.display.internal === "ruby-base" || node.display.internal === "ruby-text"));
    }

    private keyword(value?: CssValue): string | undefined {
        return value !== undefined && value.kind === "ident" ? value.lower : undefined;
    }

    private textOf(node: BoxNode): string {
        // "The content comparison for auto-hiding ... ignores elements (considers only the textContent of the boxes)."
        if (node.kind === "text") {
            return node.text;
        }
        let text: string = "";
        if (node.kind === "box") {
            for (const child of node.children) {
                text += this.textOf(child);
            }
        }
        return text;
    }
}
