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

import { ident as cssIdent, string as cssString } from "css-tree";
import { AsciiCase } from "../AsciiCase.js";
import type { CalcLeaf, CalcNode, ColorValue, CssValue } from "./CssValue.js";

const PREDEFINED_SPACES: ReadonlySet<string> = new Set<string>([
    "srgb", "srgb-linear", "display-p3", "display-p3-linear", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65",
    "rec2100-pq", "rec2100-hlg", "rec2100-linear"
]);

export class CssValueSerializer {

    private readonly asciiCase: AsciiCase = new AsciiCase();

    serialize(value: CssValue): string {
        switch (value.kind) {
            case "ident":
                return cssIdent.encode(value.name);
            case "number":
                return this.number(value.value);
            case "dimension":
                return this.number(value.value) + value.unit;
            case "length":
                return this.number(value.px) + "px";
            case "percentage":
                return this.number(value.value) + "%";
            case "hash":
                return "#" + value.value;
            case "string":
                return cssString.encode(value.value);
            case "url":
                return "url(" + cssString.encode(value.href) + ")";
            case "unicode-range":
                return "U+" + value.start.toString(16) + (value.end === value.start ? "" : "-" + value.end.toString(16));
            case "color":
                return this.color(value);
            case "device-cmyk": {
                // CSS Color 5 §11.5: the components as numbers, and the alpha only when it is not 1.
                const inks: string = value.components.map((ink: number | null) => ink === null ? "none" : this.number(ink)).join(" ");
                return "device-cmyk(" + inks + (value.alpha === 1 ? "" : " / " + (value.alpha === null ? "none" : this.number(value.alpha))) + ")";
            }
            case "profile-color": {
                // CSS Color 5 §11.4: color(), the name of the profile and the components as numbers.
                const parts: string = value.components.map((part: number | null) => part === null ? "none" : this.number(part)).join(" ");
                return "color(" + value.profile + " " + parts + (value.alpha === 1 ? "" : " / " + (value.alpha === null ? "none" : this.number(value.alpha))) + ")";
            }
            case "function":
                return value.name + "(" + value.args.map((argument: CssValue) => this.serialize(argument)).join(", ") + ")";
            case "block":
                return value.bracket + (value.content === undefined ? "" : this.serialize(value.content)) + (value.bracket === "[" ? "]" : ")");
            case "list":
                return value.items.map((item: CssValue) => this.serialize(item)).join(value.separator === "comma" ? ", " : " ");
            case "slash":
                return "/";
            case "calc":
                return "calc(" + this.calculation(value.root) + ")";
        }
    }

    private calculation(node: CalcNode): string {
        // CSS Values 4 §10.13: the calculation tree written back as an expression.
        if (node.kind === "leaf") {
            return this.number(node.value) + node.unit;
        }
        if (node.kind === "channel") {
            return node.name;
        }
        if (node.kind === "anchor") {
            const specifier: string = [node.anchor, node.keyword].filter((part?: string) => part !== undefined).join(" ");
            const fallback: string = node.fallback === undefined ? "" : (specifier.length === 0 ? "" : ", ") + this.calculation(node.fallback);
            return node.name + "(" + specifier + fallback + ")";
        }
        if (node.kind === "round") {
            return "round(" + node.strategy + ", " + node.children.map((child: CalcNode) => this.calculation(child)).join(", ") + ")";
        }
        switch (node.operator) {
            case "sum":
                return this.sorted(node.children).map((child: CalcNode, index: number) => {
                    if (child.kind === "operation" && child.operator === "negate") {
                        return (index === 0 ? "-1 * " : " - ") + this.operand(child.children[0]);
                    }
                    if (index > 0 && child.kind === "leaf" && child.value < 0) {
                        return " - " + this.number(-child.value) + child.unit;
                    }
                    return (index === 0 ? "" : " + ") + this.calculation(child);
                }).join("");
            case "product":
                return this.sorted(node.children).map((child: CalcNode, index: number) => {
                    if (child.kind === "operation" && child.operator === "invert") {
                        return (index === 0 ? "1 / " : " / ") + this.operand(child.children[0]);
                    }
                    return (index === 0 ? "" : " * ") + this.operand(child);
                }).join("");
            case "negate":
                return "-1 * " + this.operand(node.children[0]);
            case "invert":
                return "1 / " + this.operand(node.children[0]);
            default:
                return node.operator + "(" + node.children.map((child: CalcNode) => this.calculation(child)).join(", ") + ")";
        }
    }

    private sorted(nodes: ReadonlyArray<CalcNode>): ReadonlyArray<CalcNode> {
        // §10.13: the number, the percentage, the dimensions by their units "ordered ASCII case-insensitively", then the rest.
        const rank: (node: CalcNode) => number = (node: CalcNode): number => node.kind !== "leaf" ? 3 : (node.unit === "" ? 0 : (node.unit === "%" ? 1 : 2));
        return [...nodes].sort((first: CalcNode, second: CalcNode) => {
            if (rank(first) !== 2 || rank(second) !== 2) {
                return rank(first) - rank(second);
            }
            const left: string = this.asciiCase.foldLower((first as CalcLeaf).unit);
            const right: string = this.asciiCase.foldLower((second as CalcLeaf).unit);
            return left < right ? -1 : (left > right ? 1 : 0);
        });
    }

    private operand(node: CalcNode): string {
        const text: string = this.calculation(node);
        return node.kind === "operation" && ["sum", "product", "negate", "invert"].includes(node.operator) ? "(" + text + ")" : text;
    }

    private color(value: ColorValue): string {
        // CSS Color 4 §16.2.2: sRGB colors from the legacy syntaxes serialize as rgb() or rgba() with 0 to 255 channels, unless
        // one has a missing component: rgb() then goes to color(), and hsl() and hwb() keep their function and write none.
        const component: (index: number) => string = (index: number): string => {
            const channel: number | null = value.components[index];
            return channel === null ? "none" : this.number(channel);
        };
        const alpha: string = value.alpha === null ? " / none" : (value.alpha === 1 ? "" : " / " + this.number(value.alpha));
        if (value.space === "hsl" || value.space === "hwb") {
            const percentage: (index: number) => string = (index: number): string => value.components[index] === null ? "none" : component(index) + "%";
            return value.space + "(" + component(0) + " " + percentage(1) + " " + percentage(2) + alpha + ")";
        }
        if (value.space === "srgb" && value.legacy && value.alpha !== null && !value.components.includes(null)) {
            const channels: Array<string> = [0, 1, 2].map((index: number) => String(Math.round(Math.min(1, Math.max(0, value.components[index] ?? 0)) * 255)));
            return value.alpha === 1 ? "rgb(" + channels.join(", ") + ")" : "rgba(" + channels.join(", ") + ", " + this.number(value.alpha) + ")";
        }
        if (PREDEFINED_SPACES.has(value.space)) {
            return "color(" + value.space + " " + component(0) + " " + component(1) + " " + component(2) + alpha + ")";
        }
        return value.space + "(" + component(0) + " " + component(1) + " " + component(2) + alpha + ")";
    }

    private number(value: number): string {
        // CSS Values 4 §10.12: infinite and NaN values only appear inside calculations.
        if (Number.isNaN(value)) {
            return "NaN";
        }
        if (!Number.isFinite(value)) {
            return value > 0 ? "infinity" : "-infinity";
        }
        return String(value === 0 ? 0 : value);
    }
}
