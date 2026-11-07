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

import type { CompiledSelector } from "./CompiledSelector.js";
import type { CssValue } from "./values/CssValue.js";

export interface AnPlusB {
    a: number;
    b: number;
}

export type CssWideKeyword = "initial" | "inherit" | "unset" | "revert" | "revert-layer";

export interface ParsedValue {
    kind: "value";
    value: CssValue;
}

export interface KeywordValue {
    kind: "keyword";
    keyword: CssWideKeyword;
}

export interface PendingSubstitution {
    kind: "pending";
    text: string;
    shorthand?: string;
    baseUrl: string;
    namespaces: ReadonlyMap<string, string>;
}

export interface CustomPropertyValue {
    kind: "custom";
    text: string;
    baseUrl: string;
    namespaces: ReadonlyMap<string, string>;
}

export interface ToggleValue {
    kind: "toggle";
    values: ReadonlyArray<ParsedValue | KeywordValue>;
}

export type DeclaredValue = ParsedValue | KeywordValue | PendingSubstitution | CustomPropertyValue | ToggleValue;

export interface Declaration {
    property: string;
    value: DeclaredValue;
    important: boolean;
}

export interface ContainerCondition {
    name?: string;
    query?: string;
}

export interface ContainerQuery {
    conditions: ReadonlyArray<ContainerCondition>;
    negated: boolean;
}

export interface Scope {
    start?: ReadonlyArray<CompiledSelector>;
    end?: ReadonlyArray<CompiledSelector>;
    parent?: Scope;
}

export interface StyleRule {
    kind: "style";
    selectors: ReadonlyArray<CompiledSelector>;
    declarations: ReadonlyArray<Declaration>;
    containers: ReadonlyArray<ContainerQuery>;
    scope?: Scope;
    layer: number;
    order: number;
}

export type PagePseudoClass = "first" | "left" | "right" | "blank";

export interface PageNth {
    expression: AnPlusB;
    group?: string;
}

export interface PageSelector {
    name?: string;
    pseudoClasses: ReadonlyArray<PagePseudoClass>;
    nth: ReadonlyArray<PageNth>;
    specificity: readonly [number, number, number];
}

export type MarginBoxName =
    | "top-left-corner" | "top-left" | "top-center" | "top-right" | "top-right-corner"
    | "right-top" | "right-middle" | "right-bottom"
    | "bottom-right-corner" | "bottom-right" | "bottom-center" | "bottom-left" | "bottom-left-corner"
    | "left-bottom" | "left-middle" | "left-top";

export interface MarginRule {
    name: MarginBoxName;
    declarations: ReadonlyArray<Declaration>;
}

export interface PageRule {
    kind: "page";
    selectors: ReadonlyArray<PageSelector>;
    declarations: ReadonlyArray<Declaration>;
    marginRules: ReadonlyArray<MarginRule>;
    footnote: ReadonlyArray<Declaration>;
    layer: number;
    order: number;
}

export interface FontFaceSource {
    kind: "url" | "local";
    location: string;
    format?: string;
    technologies?: ReadonlyArray<string>;
}

export interface FontFaceRule {
    kind: "font-face";
    family: string;
    sources: ReadonlyArray<FontFaceSource>;
    descriptors: Readonly<Record<string, CssValue>>;
    order: number;
}

export interface CounterStyleRule {
    kind: "counter-style";
    name: string;
    descriptors: Readonly<Record<string, CssValue>>;
    layer: number;
    order: number;
}

export interface PropertyRule {
    kind: "property";
    name: string;
    syntax: string;
    inherits: boolean;
    initialValue?: string;
    order: number;
}

export interface FontFeatureValuesRule {
    kind: "font-feature-values";
    families: ReadonlyArray<string>;
    features: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<number>>>>>;
    order: number;
}

export interface DescriptorRule {
    kind: "font-palette-values" | "color-profile";
    name: string;
    descriptors: Readonly<Record<string, DeclaredValue>>;
    order: number;
}

export interface PositionTryRule {
    kind: "position-try";
    name: string;
    declarations: ReadonlyArray<Declaration>;
    layer: number;
    order: number;
}

export interface FunctionParameter {
    name: string;
    type: string;
    defaultValue?: string;
}

export interface FunctionDescriptor {
    name: string;
    text: string;
    containers: ReadonlyArray<ContainerQuery>;
}

export interface FunctionRule {
    kind: "function";
    name: string;
    parameters: ReadonlyArray<FunctionParameter>;
    returnType: string;
    body: ReadonlyArray<FunctionDescriptor>;
    baseUrl: string;
    namespaces: ReadonlyMap<string, string>;
    layer: number;
    order: number;
}

export interface TocRule {
    kind: string;
    level?: number;
    declarations: ReadonlyArray<Declaration>;
    order: number;
}

export interface Stylesheet {
    styleRules: ReadonlyArray<StyleRule>;
    pageRules: ReadonlyArray<PageRule>;
    fontFaces: ReadonlyArray<FontFaceRule>;
    fontFeatureValues: ReadonlyArray<FontFeatureValuesRule>;
    fontPalettes: ReadonlyArray<DescriptorRule>;
    colorProfiles: ReadonlyArray<DescriptorRule>;
    counterStyles: ReadonlyArray<CounterStyleRule>;
    properties: ReadonlyArray<PropertyRule>;
    positionTries: ReadonlyArray<PositionTryRule>;
    functions: ReadonlyArray<FunctionRule>;
    customMedia: ReadonlyArray<readonly [string, string | boolean]>;
    supportsConditions: ReadonlyArray<readonly [string, boolean]>;
    tocRules: ReadonlyArray<TocRule>;
    layerCount: number;
    diagnostics: ReadonlyArray<string>;
}
