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

export type BaseType = "length" | "angle" | "time" | "frequency" | "resolution" | "flex" | "percent";

export interface IdentValue {
    kind: "ident";
    name: string;
    lower: string;
}

interface NumberValue {
    kind: "number";
    value: number;
    integer: boolean;
}

interface DimensionValue {
    kind: "dimension";
    value: number;
    unit: string;
}

interface LengthValue {
    kind: "length";
    px: number;
}

interface PercentageValue {
    kind: "percentage";
    value: number;
}

interface HashValue {
    kind: "hash";
    value: string;
}

interface StringValue {
    kind: "string";
    value: string;
}

interface UrlValue {
    kind: "url";
    href: string;
}

interface UnicodeRangeValue {
    kind: "unicode-range";
    start: number;
    end: number;
}

export type ColorSpace =
    | "srgb" | "srgb-linear" | "display-p3" | "display-p3-linear" | "a98-rgb" | "prophoto-rgb" | "rec2020"
    | "xyz-d50" | "xyz-d65" | "lab" | "lch" | "oklab" | "oklch" | "hsl" | "hwb"
    | "rec2100-pq" | "rec2100-hlg" | "rec2100-linear" | "ictcp" | "jzazbz" | "jzczhz";

export interface ColorValue {
    kind: "color";
    space: ColorSpace;
    components: readonly [number | null, number | null, number | null];
    alpha: number | null;
    legacy: boolean;
}

export interface DeviceCmykValue {
    kind: "device-cmyk";
    components: readonly [number | null, number | null, number | null, number | null];
    alpha: number | null;
}

export interface ProfileColorValue {
    kind: "profile-color";
    profile: string;
    components: ReadonlyArray<number | null>;
    alpha: number | null;
}

export interface FunctionValue {
    kind: "function";
    name: string;
    args: ReadonlyArray<CssValue>;
}

interface BlockValue {
    kind: "block";
    bracket: "[" | "(";
    content?: CssValue;
}

interface ListValue {
    kind: "list";
    separator: "space" | "comma";
    items: ReadonlyArray<CssValue>;
}

interface SlashValue {
    kind: "slash";
}

export interface CalcLeaf {
    kind: "leaf";
    value: number;
    unit: string;
}

export type CalcOperator =
    | "sum" | "product" | "negate" | "invert"
    | "min" | "max" | "clamp" | "mod" | "rem"
    | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "atan2"
    | "pow" | "sqrt" | "hypot" | "log" | "exp"
    | "abs" | "sign";

export interface CalcOperation {
    kind: "operation";
    operator: CalcOperator;
    children: ReadonlyArray<CalcNode>;
}

export type RoundingStrategy = "nearest" | "up" | "down" | "to-zero";

interface CalcRounding {
    kind: "round";
    strategy: RoundingStrategy;
    children: ReadonlyArray<CalcNode>;
}

interface CalcChannel {
    kind: "channel";
    name: string;
}

export interface CalcAnchor {
    kind: "anchor";
    name: string;
    anchor?: string;
    keyword?: string;
    fallback?: CalcNode;
    owner?: number;
}

export type CalcNode = CalcLeaf | CalcOperation | CalcRounding | CalcChannel | CalcAnchor;

interface CalcValue {
    kind: "calc";
    root: CalcNode;
}

export type CssValue =
    | IdentValue
    | NumberValue
    | DimensionValue
    | LengthValue
    | PercentageValue
    | HashValue
    | StringValue
    | UrlValue
    | UnicodeRangeValue
    | ColorValue
    | DeviceCmykValue
    | ProfileColorValue
    | FunctionValue
    | BlockValue
    | ListValue
    | SlashValue
    | CalcValue;
