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

import type { AnPlusB } from "./Stylesheet.js";

export type Combinator = "descendant" | "child" | "adjacentSibling" | "generalSibling" | "column" | "reference";

export type NamespaceConstraint =
    | { kind: "any" }
    | { kind: "none" }
    | { kind: "uri"; uri: string };

export interface ReferenceAttribute {
    name: string;
    namespace: NamespaceConstraint;
}

export type AttributeOperator = "=" | "~=" | "|=" | "^=" | "$=" | "*=";

export interface AttributeMatcher {
    name: string;
    namespace: NamespaceConstraint;
    operator?: AttributeOperator;
    value?: string;
    caseInsensitive: boolean;
}

export type TypeMatcher =
    | { kind: "any"; namespace: NamespaceConstraint }
    | { kind: "localName"; name: string; namespace: NamespaceConstraint };

export type StructuralPseudoClass = "root" | "empty" | "first-child" | "last-child" | "only-child" | "first-of-type" | "last-of-type" | "only-of-type" | "scope" | "any-link";

export type Direction = "ltr" | "rtl";

export type NthKind = "child" | "last-child" | "of-type" | "last-of-type" | "col" | "last-col";

export interface NthMatcher {
    kind: NthKind;
    expression: AnPlusB;
    of?: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>;
}

export interface RelativeSelector {
    combinator: Combinator;
    reference?: ReferenceAttribute;
    steps: ReadonlyArray<CompiledSelectorStep>;
}

export interface CompoundSelector {
    type: TypeMatcher;
    ids?: ReadonlyArray<string>;
    classes?: ReadonlyArray<string>;
    attributes?: ReadonlyArray<AttributeMatcher>;
    structural?: ReadonlyArray<StructuralPseudoClass>;
    negations?: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>;
    anyOf?: ReadonlyArray<ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>>;
    has?: ReadonlyArray<ReadonlyArray<RelativeSelector>>;
    nth?: ReadonlyArray<NthMatcher>;
    lang?: ReadonlyArray<ReadonlyArray<string>>;
    dir?: ReadonlyArray<Direction>;
    localLinks?: ReadonlyArray<number>;
    never: boolean;
}

export interface CompiledSelectorStep {
    compound: CompoundSelector;
    combinator?: Combinator;
    reference?: ReferenceAttribute;
}

export interface CompiledSelector {
    steps: ReadonlyArray<CompiledSelectorStep>;
    pseudoElement?: string;
    specificity: readonly [number, number, number];
}
