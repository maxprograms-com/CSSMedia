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

import type { NumericCategory, NumericType } from "./CalcTypes.js";
import { CalcTypes } from "./CalcTypes.js";
import type { CalcContext } from "./CalcSimplifier.js";
import { CalcSimplifier } from "./CalcSimplifier.js";
import { ColorKeywords } from "./ColorKeywords.js";
import { ColorSpaces } from "./ColorSpaces.js";
import { CssUnits } from "./CssUnits.js";
import type { CalcNode, ColorSpace, ColorValue, CssValue, DeviceCmykValue, FunctionValue, IdentValue, ProfileColorValue } from "./CssValue.js";

export interface ProfileColors {
    channels(name: string): number | undefined;
    components(name: string): ReadonlyArray<string> | undefined;
    toColor(name: string, components: ReadonlyArray<number>, alpha: number | null): ColorValue | undefined;
    fromColor(name: string, color: ColorValue): Array<number> | undefined;
}

export type ParsedColor = ColorValue | DeviceCmykValue | ProfileColorValue | IdentValue | FunctionValue | "unresolved";

type ComponentUnit = "" | "%" | "deg";

interface Component {
    value: number;
    unit: ComponentUnit;
}

type ComponentResult = Component | null | "unresolved" | undefined;

type Triple = [number, number, number];

const PREDEFINED_SPACES: ReadonlyMap<string, ColorSpace> = new Map<string, ColorSpace>([
    ["srgb", "srgb"], ["srgb-linear", "srgb-linear"], ["display-p3", "display-p3"], ["display-p3-linear", "display-p3-linear"],
    ["a98-rgb", "a98-rgb"], ["prophoto-rgb", "prophoto-rgb"], ["rec2020", "rec2020"],
    ["rec2100-pq", "rec2100-pq"], ["rec2100-hlg", "rec2100-hlg"], ["rec2100-linear", "rec2100-linear"],
    ["xyz", "xyz-d65"], ["xyz-d50", "xyz-d50"], ["xyz-d65", "xyz-d65"]
]);

const INTERPOLATION_SPACES: ReadonlyMap<string, ColorSpace> = new Map<string, ColorSpace>([
    ...PREDEFINED_SPACES, ["lab", "lab"], ["oklab", "oklab"], ["hsl", "hsl"], ["hwb", "hwb"], ["lch", "lch"], ["oklch", "oklch"]
]);
const RELATIVE_SPACES: ReadonlyMap<string, ColorSpace> = new Map<string, ColorSpace>([
    ["rgb", "srgb"], ["rgba", "srgb"], ["hsl", "hsl"], ["hsla", "hsl"], ["hwb", "hwb"], ["lab", "lab"], ["oklab", "oklab"], ["lch", "lch"], ["oklch", "oklch"],
    ["ictcp", "ictcp"], ["jzazbz", "jzazbz"], ["jzczhz", "jzczhz"]
]);
const HUE_SCALE: readonly [number, number] = [1, 0];
const SAME_SCALE: readonly [number, number] = [1, 1];
const RELATIVE_SCALES: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>> = new Map<string, ReadonlyArray<readonly [number, number]>>([
    ["rgb", [[1 / 255, 0.01], [1 / 255, 0.01], [1 / 255, 0.01]]], ["rgba", [[1 / 255, 0.01], [1 / 255, 0.01], [1 / 255, 0.01]]],
    ["hsl", [HUE_SCALE, SAME_SCALE, SAME_SCALE]], ["hsla", [HUE_SCALE, SAME_SCALE, SAME_SCALE]], ["hwb", [HUE_SCALE, SAME_SCALE, SAME_SCALE]],
    ["lab", [SAME_SCALE, [1, 1.25], [1, 1.25]]], ["oklab", [[1, 0.01], [1, 0.004], [1, 0.004]]],
    ["lch", [SAME_SCALE, [1, 1.5], HUE_SCALE]], ["oklch", [[1, 0.01], [1, 0.004], HUE_SCALE]],
    ["ictcp", [[1, 0.01], [1, 0.005], [1, 0.005]]], ["jzazbz", [[1, 0.01], [1, 0.0021], [1, 0.0021]]], ["jzczhz", [[1, 0.01], [1, 0.0026], HUE_SCALE]],
    ["color", [[1, 0.01], [1, 0.01], [1, 0.01]]], ["alpha", []]
]);
const DEVICE_CMYK: string = "device-cmyk";
const POLAR_SPACES: ReadonlySet<ColorSpace> = new Set<ColorSpace>(["hsl", "hwb", "lch", "oklch"]);
const HUE_METHODS: ReadonlySet<string> = new Set<string>(["shorter", "longer", "increasing", "decreasing"]);

const NOT_ABSOLUTE: ReadonlySet<string> = new Set<string>(["light-dark", "contrast-color", "device-cmyk"]);

const HEX_DIGITS: RegExp = /^[0-9a-f]+$/i;

const UNBOUNDED_LIMIT: number = 1e6;

export class ColorParser {

    private readonly keywords: ColorKeywords = new ColorKeywords();
    private readonly spaces: ColorSpaces = new ColorSpaces();
    private readonly types: CalcTypes = new CalcTypes();
    private readonly simplifier: CalcSimplifier = new CalcSimplifier();
    private readonly units: CssUnits = new CssUnits();
    private readonly profiles?: ProfileColors;

    static isPredefinedSpace(name: string): boolean {
        return PREDEFINED_SPACES.has(name.toLowerCase());
    }

    constructor(profiles?: ProfileColors) {
        // The valid color profiles of the stylesheet, which the colors of custom color spaces are computed with.
        if (profiles !== undefined) {
            this.profiles = profiles;
        }
    }

    parse(value: CssValue, context: CalcContext): ParsedColor | undefined {
        // CSS Color 4 §4.1; context resolves what math functions in the components depend on. A color already resolved
        // comes back inside a function that waited for currentcolor.
        switch (value.kind) {
            case "color":
            case "device-cmyk":
            case "profile-color":
                return value;
            case "ident":
                return this.parseKeyword(value);
            case "hash":
                return this.parseHex(value.value);
            case "function":
                return this.parseFunction(value, { ...context, rawPercentages: true });
            default:
                return undefined;
        }
    }

    isAbsolute(value: CssValue): boolean {
        // CSS Color 5 §2: an absolute color is not currentColor, a system color, light-dark(), contrast-color() or
        // device-cmyk(), "nor are any of those values used inside color-mix() or in relative color syntax".
        switch (value.kind) {
            case "ident":
                return value.lower !== "currentcolor" && !this.keywords.isSystemColor(value.lower);
            case "function":
                return !NOT_ABSOLUTE.has(value.name) && value.args.every((argument: CssValue) => this.isAbsolute(argument));
            case "list":
                return value.items.every((item: CssValue) => this.isAbsolute(item));
            case "block":
                return value.content === undefined || this.isAbsolute(value.content);
            default:
                return true;
        }
    }

    private parseKeyword(value: IdentValue): ParsedColor | undefined {
        if (value.lower === "currentcolor" || this.keywords.isSystemColor(value.lower)) {
            return { kind: "ident", name: value.lower, lower: value.lower };
        }
        if (value.lower === "transparent") {
            return { kind: "color", space: "srgb", components: [0, 0, 0], alpha: 0, legacy: true };
        }
        const hex: string | undefined = this.keywords.namedColorHex(value.lower);
        return hex === undefined ? undefined : this.parseHex(hex);
    }

    parseHex(digits: string): ColorValue | undefined {
        // CSS Color 4 §5.2: 3, 4, 6 or 8 hexadecimal digits.
        if (!HEX_DIGITS.test(digits) || ![3, 4, 6, 8].includes(digits.length)) {
            return undefined;
        }
        const expanded: string = digits.length <= 4 ? digits.split("").map((digit: string) => digit + digit).join("") : digits;
        const channel: (index: number) => number = (index: number): number => Number.parseInt(expanded.substring(index * 2, index * 2 + 2), 16) / 255;
        return { kind: "color", space: "srgb", components: [channel(0), channel(1), channel(2)], alpha: expanded.length === 8 ? channel(3) : 1, legacy: true };
    }

    private parseFunction(value: FunctionValue, context: CalcContext): ParsedColor | undefined {
        const items: ReadonlyArray<CssValue> | undefined = value.args.length === 1 && value.args[0].kind === "list" && value.args[0].separator === "space" ? value.args[0].items : undefined;
        if (items !== undefined && items.length > 1 && items[0].kind === "ident" && items[0].lower === "from" && ColorSpaces.CHANNELS.has(value.name)) {
            return this.parseRelative(value.name, items, context);
        }
        switch (value.name) {
            case "device-cmyk":
                return this.parseDeviceCmyk(value.args, context);
            case "contrast-color":
                return this.parseContrastColor(value.args, context);
            case "ictcp":
            case "jzazbz":
            case "jzczhz":
                return this.parseHdr(value.name, value.args, context);
            case "color-hdr":
                return this.parseColorHdr(value.args, context);
            case "rgb":
            case "rgba":
                return this.parseRgb(value.args, context);
            case "hsl":
            case "hsla":
                return this.parseHsl(value.args, context);
            case "hwb":
                return this.parseHwb(value.args, context);
            case "lab":
            case "lch":
            case "oklab":
            case "oklch":
                return this.parseLab(value.name, value.args, context);
            case "color":
                return this.parseColorFunction(value.args, context);
            case "color-mix":
                return this.parseColorMix(value.args, context);
            default:
                return undefined;
        }
    }

    private parseContrastColor(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 5 §8: white or black, "whichever produces maximum color contrast", white when both give the same; the
        // algorithm is UA-defined, and the WCAG 2.1 contrast ratio makes the result meet the ratio the section asks for.
        const color: ColorValue | IdentValue | FunctionValue | "unresolved" | undefined = args.length === 1 ? this.mixedColor(args[0], context) : undefined;
        if (color === undefined || color === "unresolved") {
            return color;
        }
        if (color.kind !== "color") {
            return { kind: "function", name: "contrast-color", args: [color] };
        }
        // WCAG 2.1, relative luminance: L = 0.2126 * R + 0.7152 * G + 0.0722 * B of the linear sRGB components; the contrast
        // ratio is (L1 + 0.05) / (L2 + 0.05), with L1 the lighter color, so white has L 1 and black L 0.
        const linear: ColorValue = this.spaces.convert(color, "srgb-linear");
        const channel: (index: number) => number = (index: number): number => this.clamp(linear.components[index] ?? 0, 0, 1);
        const luminance: number = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
        const white: boolean = 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05;
        return { kind: "color", space: "srgb", components: white ? [1, 1, 1] : [0, 0, 0], alpha: 1, legacy: true };
    }

    private parseHdr(name: string, args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color HDR 1 §6.3 to §6.5: three components and an optional alpha; the percent reference ranges are 1 for I and
        // Jz, 0.5 for Ct and Cp, 0.21 for az and bz, and 0.26 for Cz, and the third component of jzczhz() is a hue.
        const components: Array<ComponentResult> | undefined = this.modernComponents(args, context);
        const scales: ReadonlyArray<readonly [number, number]> = RELATIVE_SCALES.get(name) as ReadonlyArray<readonly [number, number]>;
        if (components === undefined || components.includes(undefined)) {
            return undefined;
        }
        if (components.includes("unresolved")) {
            return "unresolved";
        }
        const values: Array<number | null> = [];
        for (let index: number = 0; index < 3; index++) {
            const component: Component | null = components[index] as Component | null;
            const hue: boolean = scales[index][1] === 0;
            if (hue ? !this.isHue(component) : !this.isNumberOrPercentage(component)) {
                return undefined;
            }
            values.push(component === null ? null : (hue ? this.hueOf(component) : this.bounded(this.scaled(component, scales[index][1]))));
        }
        const alpha: number | null | undefined = this.alphaOf(components[3]);
        return alpha === undefined ? undefined : { kind: "color", space: name as ColorSpace, components: [values[0], values[1], values[2]], alpha, legacy: false };
    }

    private parseColorHdr(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color HDR 1 §5: two colors, each with an HDR headroom, which "must not be the same"; an omitted headroom
        // counts as 0 here. §5.1: the result is interpolated for the headroom of the output, and a printed page has none.
        if (args.length !== 2) {
            return undefined;
        }
        const colors: Array<ColorValue> = [];
        const headrooms: Array<number> = [];
        const resolved: Array<CssValue> = [];
        let waiting: boolean = false;
        for (const item of args) {
            const parts: ReadonlyArray<CssValue> = item.kind === "list" && item.separator === "space" ? item.items : [item];
            const headroomPart: CssValue | undefined = parts.length === 2 ? parts.find((part: CssValue) => part.kind === "number" || part.kind === "calc") : undefined;
            const colorPart: CssValue | undefined = parts.find((part: CssValue) => part !== headroomPart);
            if (parts.length > 2 || colorPart === undefined || (parts.length === 2 && headroomPart === undefined)) {
                return undefined;
            }
            const color: ColorValue | IdentValue | FunctionValue | "unresolved" | undefined = this.mixedColor(colorPart, context);
            const headroom: ComponentResult = headroomPart === undefined ? { value: 0, unit: "" } : this.component(headroomPart, context, false);
            if (color === "unresolved" || headroom === "unresolved") {
                return "unresolved";
            }
            if (color === undefined || headroom === undefined || headroom === null || headroom.unit !== "") {
                return undefined;
            }
            waiting = waiting || color.kind !== "color";
            if (color.kind === "color") {
                colors.push(color);
            }
            headrooms.push(Math.max(0, headroom.value));
            resolved.push(headroomPart === undefined ? color : { kind: "list", separator: "space", items: parts.map((part: CssValue) => part === colorPart ? color : part) });
        }
        if (headrooms[0] === headrooms[1]) {
            return undefined;
        }
        if (waiting) {
            return { kind: "function", name: "color-hdr", args: resolved };
        }
        return this.spaces.headroomColor(colors[0], headrooms[0], colors[1], headrooms[1], 0);
    }

    private parseDeviceCmyk(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 5 §6: four numbers with commas, or four numbers, percentages or none and an optional alpha; values out of
        // the range "are clamped to 0/0% or 1/100% at computed-value time". §10.3: the computed value keeps the CMYK color.
        const legacy: boolean = args.length === 4;
        const items: ReadonlyArray<CssValue> | undefined = legacy ? args : (args.length === 1 && args[0].kind === "list" && args[0].separator === "space" ? args[0].items : undefined);
        if (items === undefined || (items.length !== 4 && items.length !== 6) || (items.length === 6 && items[4].kind !== "slash")) {
            return undefined;
        }
        const inks: Array<number | null> = [];
        for (const item of items.slice(0, 4)) {
            const ink: ComponentResult = this.component(item, context, !legacy);
            if (ink === "unresolved") {
                return "unresolved";
            }
            if (ink === undefined || (ink !== null && ink.unit !== "" && (legacy || ink.unit !== "%"))) {
                return undefined;
            }
            inks.push(ink === null ? null : this.clamp(this.scaled(ink, 0.01), 0, 1));
        }
        const opacity: ComponentResult = items.length === 6 ? this.component(items[5], context, true) : { value: 1, unit: "" };
        if (opacity === "unresolved") {
            return "unresolved";
        }
        const alpha: number | null | undefined = this.alphaOf(opacity);
        return alpha === undefined ? undefined : { kind: "device-cmyk", components: [inks[0], inks[1], inks[2], inks[3]], alpha };
    }

    private parseRelative(name: string, items: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 5 §4.1: the origin color is converted to the space of the function, its components are the values of the
        // component keywords, and an omitted alpha is that of the origin color.
        const origin: ColorValue | IdentValue | FunctionValue | "unresolved" | undefined = this.mixedColor(items[1], context);
        if (origin === undefined || origin === "unresolved") {
            return origin;
        }
        if (origin.kind !== "color") {
            // §10.2: with currentcolor the computed value is the function "with the origin <color> parameter resolved".
            return { kind: "function", name, args: [{ kind: "list", separator: "space", items: [items[0], origin, ...items.slice(2)] }] };
        }
        const spaceName: CssValue | undefined = name === "color" ? items[2] : undefined;
        if (spaceName !== undefined && spaceName.kind === "ident" && spaceName.name.startsWith("--")) {
            return this.parseRelativeProfile(spaceName.name, origin, items.slice(3), context);
        }
        const space: ColorSpace | undefined = name === "alpha" ? origin.space
            : (spaceName === undefined ? RELATIVE_SPACES.get(name) : (spaceName.kind === "ident" ? PREDEFINED_SPACES.get(spaceName.lower) : undefined));
        const scales: ReadonlyArray<readonly [number, number]> | undefined = RELATIVE_SCALES.get(name);
        if (space === undefined || scales === undefined) {
            return undefined;
        }
        // §4.1: missing components are carried forward as in CSS Color 4 §13.3, and "none is treated as 0" in a calculation.
        const converted: ColorValue = this.spaces.carriedForward(origin, space);
        const xyz: boolean = name === "color" && (space === "xyz-d50" || space === "xyz-d65");
        const names: ReadonlyArray<string> = xyz ? ColorSpaces.XYZ_CHANNELS : ColorSpaces.CHANNELS.get(name) as ReadonlyArray<string>;
        const channels: Map<string, number | null> = new Map<string, number | null>([[ColorSpaces.ALPHA_CHANNEL, converted.alpha]]);
        names.forEach((channel: string, index: number) => {
            const component: number | null = converted.components[index];
            channels.set(channel, component === null ? null : component / scales[index][0]);
        });
        const rest: ReadonlyArray<CssValue> = items.slice(spaceName === undefined ? 2 : 3).map((item: CssValue) => this.withChannels(item, channels));
        const count: number = name === "alpha" ? 0 : 3;
        if ((rest.length !== count && rest.length !== count + 2) || (rest.length === count + 2 && rest[count].kind !== "slash")) {
            return undefined;
        }
        const components: Array<number | null> = [];
        for (let index: number = 0; index < count; index++) {
            // §4.1: with an origin color the components "are not clamped to the reference ranges but are retained as-is".
            const component: ComponentResult = this.component(rest[index], context, true);
            const hue: boolean = scales[index][1] === 0;
            if (component === "unresolved") {
                return "unresolved";
            }
            if (component === undefined || (component !== null && component.unit !== "" && component.unit !== (hue ? "deg" : "%"))) {
                return undefined;
            }
            if (component === null) {
                components.push(null);
            } else {
                components.push(hue ? this.hueOf(component) : this.bounded(component.unit === "%" ? component.value * scales[index][1] : component.value * scales[index][0]));
            }
        }
        // §4.1: the alpha component, "whether directly specified or arising from color space conversion", is clamped.
        const opacity: ComponentResult = rest.length === count + 2 ? this.component(rest[count + 1], context, true) : (converted.alpha === null ? null : { value: converted.alpha, unit: "" });
        if (opacity === "unresolved") {
            return "unresolved";
        }
        const alpha: number | null | undefined = this.alphaOf(opacity);
        if (alpha === undefined) {
            return undefined;
        }
        const result: ColorValue = { kind: "color", space, components: count === 0 ? converted.components : [components[0], components[1], components[2]], alpha, legacy: false };
        // CSS Color 4 §15.1: hsl() and hwb() resolve to sRGB.
        const resolved: ColorValue = space === "hsl" || space === "hwb" ? this.spaces.convert(result, "srgb") : result;
        return { kind: "color", space: resolved.space, components: resolved.components, alpha, legacy: false };
    }

    private parseRelativeProfile(profile: string, origin: ColorValue, rest: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 5 §5.1: with <custom-params> the component keywords are "defined by the components descriptor on the
        // corresponding @color-profile, if present; otherwise, no relative color manipulation is valid", and 1.0 is 100%.
        const names: ReadonlyArray<string> | undefined = this.profiles?.components(profile);
        const device: Array<number> | undefined = names === undefined || names.length === 0 ? undefined : this.profiles?.fromColor(profile, origin);
        const count: number | undefined = this.profiles?.channels(profile);
        const slash: number = rest.findIndex((item: CssValue) => item.kind === "slash");
        const parts: ReadonlyArray<CssValue> = slash === -1 ? rest : rest.slice(0, slash);
        if (names === undefined || device === undefined || count === undefined || parts.length === 0 || (slash !== -1 && slash !== rest.length - 2)) {
            return undefined;
        }
        const channels: Map<string, number | null> = new Map<string, number | null>([[ColorSpaces.ALPHA_CHANNEL, origin.alpha]]);
        names.forEach((name: string, index: number) => channels.set(name, device[index] ?? 0));
        if (rest.some((item: CssValue) => item.kind === "calc" && !this.knowsChannels(item.root, channels))) {
            return undefined;
        }
        const components: Array<number | null> = [];
        for (const part of parts.slice(0, count)) {
            const component: ComponentResult = this.component(this.withChannels(part, channels), context, true);
            if (component === "unresolved") {
                return "unresolved";
            }
            if (component === undefined || (component !== null && component.unit !== "" && component.unit !== "%")) {
                return undefined;
            }
            components.push(component === null ? null : this.clamp(this.scaled(component, 0.01), 0, 1));
        }
        while (components.length < count) {
            components.push(0);
        }
        const opacity: ComponentResult = slash === -1 ? (origin.alpha === null ? null : { value: origin.alpha, unit: "" })
            : this.component(this.withChannels(rest[slash + 1], channels), context, true);
        if (opacity === "unresolved") {
            return "unresolved";
        }
        const alpha: number | null | undefined = this.alphaOf(opacity);
        return alpha === undefined ? undefined : { kind: "profile-color", profile, components, alpha };
    }

    private knowsChannels(node: CalcNode, channels: ReadonlyMap<string, number | null>): boolean {
        if (node.kind === "channel") {
            return channels.has(node.name);
        }
        return node.kind === "leaf" || node.kind === "anchor" || node.children.every((child: CalcNode) => this.knowsChannels(child, channels));
    }

    private withChannels(value: CssValue, channels: ReadonlyMap<string, number | null>): CssValue {
        // CSS Color 5 §4.2: "The component keywords return a <number>, or none".
        if (value.kind === "ident" && channels.has(value.lower)) {
            const channel: number | null = channels.get(value.lower) as number | null;
            return channel === null ? { kind: "ident", name: "none", lower: "none" } : { kind: "number", value: channel, integer: false };
        }
        return value.kind === "calc" ? { kind: "calc", root: this.calcWithChannels(value.root, channels) } : value;
    }

    private calcWithChannels(node: CalcNode, channels: ReadonlyMap<string, number | null>): CalcNode {
        if (node.kind === "channel") {
            return { kind: "leaf", value: channels.get(node.name) ?? 0, unit: "" };
        }
        if (node.kind === "leaf" || node.kind === "anchor") {
            return node;
        }
        const children: Array<CalcNode> = node.children.map((child: CalcNode) => this.calcWithChannels(child, channels));
        return node.kind === "round" ? { kind: "round", strategy: node.strategy, children } : { kind: "operation", operator: node.operator, children };
    }

    private parseColorMix(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 5 §3: one or more colors, each with an optional percentage, and "If no color interpolation method is
        // specified, assume Oklab"; the percentages follow the text of 18 March 2025 §3.1, the latest published one with them.
        const method: CssValue | undefined = args.length > 0 && this.isInterpolationMethod(args[0]) ? args[0] : undefined;
        const custom: string | undefined = method === undefined ? undefined : this.customSpace(method);
        const interpolation: [ColorSpace, string] | undefined = method === undefined ? ["oklab", "shorter"] : (custom === undefined ? this.interpolationMethod(method) : undefined);
        const items: ReadonlyArray<CssValue> = method === undefined ? args : args.slice(1);
        if ((interpolation === undefined && custom === undefined) || items.length === 0) {
            return undefined;
        }
        const colors: Array<ColorValue | IdentValue | FunctionValue> = [];
        const shares: Array<number> = [];
        let omitted: number = 0;
        const resolved: Array<CssValue> = [];
        let unresolved: boolean = false;
        for (const item of items) {
            const parts: ReadonlyArray<CssValue> = item.kind === "list" && item.separator === "space" ? item.items : [item];
            const sharePart: CssValue | undefined = parts.length === 2 ? parts.find((part: CssValue) => part.kind === "percentage" || part.kind === "calc") : undefined;
            const colorPart: CssValue | undefined = parts.find((part: CssValue) => part !== sharePart);
            if (parts.length > 2 || colorPart === undefined || (parts.length === 2 && sharePart === undefined)) {
                return undefined;
            }
            const color: ColorValue | IdentValue | FunctionValue | "unresolved" | undefined = this.mixedColor(colorPart, context);
            const share: number | "unresolved" | undefined | null = sharePart === undefined ? null : this.mixShare(sharePart, context);
            if (color === undefined || share === undefined) {
                return undefined;
            }
            if (color === "unresolved" || share === "unresolved") {
                unresolved = true;
                continue;
            }
            colors.push(color);
            // An omitted percentage is kept as NaN until the given ones are added up.
            shares.push(share ?? Number.NaN);
            omitted += share === null ? 1 : 0;
            resolved.push(sharePart === undefined ? color : { kind: "list", separator: "space", items: parts.map((part: CssValue) => part === colorPart ? color : part) });
        }
        if (unresolved) {
            return "unresolved";
        }
        if (colors.some((color: ColorValue | IdentValue | FunctionValue) => color.kind !== "color")) {
            // §10.1: with currentcolor "the computed value is the color-mix() function with each <color> parameter resolved".
            return { kind: "function", name: "color-mix", args: method === undefined ? resolved : [method, ...resolved] };
        }
        // The 2025 text: an omitted percentage is what the others leave of 100%, shared when several are omitted; a sum
        // below 100% is kept as an alpha multiplier, and the percentages are then scaled to add up to 100%.
        const given: number = shares.reduce((total: number, share: number) => total + (Number.isNaN(share) ? 0 : share), 0);
        const quantities: Array<number> = shares.map((share: number) => Number.isNaN(share) ? Math.max(0, 100 - given) / omitted : share);
        const sum: number = quantities.reduce((total: number, quantity: number) => total + quantity, 0);
        // CSS Color 5 §3.3: the colors are mixed in order, each result with the next one, with a progress of the second
        // percentage over the combined one, "if combined percentage is greater than 0, and 0.5 otherwise".
        if (interpolation === undefined) {
            return this.mixInProfile(custom as string, colors as Array<ColorValue>, quantities, Math.min(1, sum / 100));
        }
        let mixed: ColorValue = this.spaces.interpolate(colors[0] as ColorValue, colors[0] as ColorValue, interpolation[0], interpolation[1], 0);
        let combined: number = quantities[0];
        for (let index: number = 1; index < colors.length; index++) {
            const total: number = combined + quantities[index];
            mixed = this.spaces.interpolate(mixed, colors[index] as ColorValue, interpolation[0], interpolation[1], total > 0 ? quantities[index] / total : 0.5);
            combined = total;
        }
        const alpha: number | null = mixed.alpha === null ? null : mixed.alpha * Math.min(1, sum / 100);
        // CSS Color 4 §15.1: hsl() and hwb() resolve to sRGB, and what is mixed is not a legacy color.
        const result: ColorValue = mixed.space === "hsl" || mixed.space === "hwb" ? this.spaces.convert(mixed, "srgb") : mixed;
        return { kind: "color", space: result.space, components: result.components, alpha, legacy: false };
    }

    used(value: CssValue, current: ColorValue): ColorValue | DeviceCmykValue | ProfileColorValue | undefined {
        // CSS Color 4 §15.5: in the color property "the used value of currentcolor is the resolved inherited value", and in
        // any other property "the used value of the color property on the same element"; the caller gives that color.
        if (value.kind === "device-cmyk" || value.kind === "profile-color") {
            return value;
        }
        const parsed: ColorValue | IdentValue | FunctionValue | "unresolved" | undefined = this.mixedColor(this.withCurrentColor(value, current), this.simplifier.specifiedContext());
        return parsed !== undefined && parsed !== "unresolved" && parsed.kind === "color" ? parsed : undefined;
    }

    private withCurrentColor(value: CssValue, current: ColorValue): CssValue {
        switch (value.kind) {
            case "ident":
                return value.lower === "currentcolor" ? current : value;
            case "function":
                return { kind: "function", name: value.name, args: value.args.map((argument: CssValue) => this.withCurrentColor(argument, current)) };
            case "list":
                return { kind: "list", separator: value.separator, items: value.items.map((item: CssValue) => this.withCurrentColor(item, current)) };
            default:
                return value;
        }
    }

    private mixedColor(value: CssValue, context: CalcContext): ColorValue | IdentValue | FunctionValue | "unresolved" | undefined {
        // CSS Color 4 §15.5: a system color computes to the color it stands for, so it can be mixed; currentcolor cannot yet.
        // CSS Color 5 §10.3: for blending with other colors a device-cmyk() color "must be converted" as its §6 says.
        const parsed: ParsedColor | undefined = this.parse(value, context);
        if (parsed === undefined || parsed === "unresolved") {
            return parsed;
        }
        if (parsed.kind === "device-cmyk") {
            // CSS Color 5 §6: with a valid CMYK profile for device-cmyk the color is the one the profile gives, and
            // otherwise the one of the naive conversion.
            const inks: Array<number> = parsed.components.map((ink: number | null) => ink ?? 0);
            return this.profiles?.toColor(DEVICE_CMYK, inks, parsed.alpha) ?? this.spaces.cmykToSrgb(parsed);
        }
        if (parsed.kind === "profile-color") {
            return this.profiles?.toColor(parsed.profile, parsed.components.map((component: number | null) => component ?? 0), parsed.alpha);
        }
        if (parsed.kind !== "ident" || parsed.lower === "currentcolor") {
            return parsed;
        }
        const hex: string | undefined = this.keywords.systemColorHex(parsed.lower);
        return hex === undefined ? undefined : this.parseHex(hex);
    }

    private mixShare(value: CssValue, context: CalcContext): number | "unresolved" | undefined {
        // <percentage [0,100]>: a percentage out of the range is invalid, and CSS Values 4 §10.12 clamps a calculation to it.
        const component: ComponentResult = this.component(value, context, false);
        if (component === "unresolved") {
            return "unresolved";
        }
        if (component === undefined || component === null || component.unit !== "%" || (value.kind === "percentage" && (component.value < 0 || component.value > 100))) {
            return undefined;
        }
        return this.clamp(component.value, 0, 100);
    }

    private isInterpolationMethod(value: CssValue): boolean {
        const first: CssValue | undefined = value.kind === "list" && value.separator === "space" ? value.items[0] : undefined;
        return first !== undefined && first.kind === "ident" && first.lower === "in";
    }

    private customSpace(method: CssValue): string | undefined {
        // CSS Color 5 §9.1: in <custom-color-space>, a <dashed-ident> that "must have been declared in a valid
        // @color-profile rule".
        const name: CssValue | undefined = method.kind === "list" && method.items.length === 2 ? method.items[1] : undefined;
        return name !== undefined && name.kind === "ident" && name.name.startsWith("--") && this.profiles?.channels(name.name) !== undefined ? name.name : undefined;
    }

    private mixInProfile(name: string, colors: ReadonlyArray<ColorValue>, quantities: ReadonlyArray<number>, alphaMultiplier: number): ParsedColor | undefined {
        // The components of a custom color space are rectangular, so each color is taken to the space of the profile and
        // the components are interpolated premultiplied, as CSS Color 4 §13.4 says, in the order of CSS Color 5 §3.3.
        let components: Array<number> | undefined = this.profiles?.fromColor(name, colors[0]);
        let alpha: number | null = colors[0].alpha;
        let combined: number = quantities[0];
        for (let index: number = 1; index < colors.length && components !== undefined; index++) {
            const next: Array<number> | undefined = this.profiles?.fromColor(name, colors[index]);
            if (next === undefined) {
                return undefined;
            }
            const total: number = combined + quantities[index];
            const progress: number = total > 0 ? quantities[index] / total : 0.5;
            const startAlpha: number | null = alpha ?? colors[index].alpha;
            const endAlpha: number | null = colors[index].alpha ?? alpha;
            const mixedAlpha: number | null = startAlpha === null || endAlpha === null ? null : startAlpha + (endAlpha - startAlpha) * progress;
            const start: Array<number> = components;
            components = start.map((component: number, channel: number) => {
                const value: number = component * (startAlpha ?? 1) + (next[channel] * (endAlpha ?? 1) - component * (startAlpha ?? 1)) * progress;
                return mixedAlpha === null || mixedAlpha === 0 ? value : value / mixedAlpha;
            });
            alpha = mixedAlpha;
            combined = total;
        }
        return components === undefined ? undefined : { kind: "profile-color", profile: name, components, alpha: alpha === null ? null : alpha * alphaMultiplier };
    }

    interpolationMethod(value: CssValue): [ColorSpace, string] | undefined {
        // CSS Color 4 §13.2: in [ <rectangular-color-space> | <polar-color-space> <hue-interpolation-method>? ], where the hue
        // method is [ shorter | longer | increasing | decreasing ] hue and defaults to shorter.
        if (value.kind !== "list") {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = value.items;
        const name: CssValue | undefined = items[1];
        const space: ColorSpace | undefined = name !== undefined && name.kind === "ident" ? INTERPOLATION_SPACES.get(name.lower) : undefined;
        if (space === undefined || (items.length !== 2 && items.length !== 4)) {
            return undefined;
        }
        if (items.length === 2) {
            return [space, "shorter"];
        }
        const hue: CssValue = items[2];
        const word: CssValue = items[3];
        if (!POLAR_SPACES.has(space) || hue.kind !== "ident" || !HUE_METHODS.has(hue.lower) || word.kind !== "ident" || word.lower !== "hue") {
            return undefined;
        }
        return [space, hue.lower];
    }

    private parseRgb(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 4 §5.1: 0% = 0.0 and 100% = 255.0, clamped to that range at parsed-value time.
        const modern: Array<ComponentResult> | undefined = this.modernComponents(args, context);
        const components: Array<ComponentResult> | undefined = modern ?? this.legacyComponents(args, context);
        if (components === undefined || components.includes(undefined)) {
            return undefined;
        }
        if (components.includes("unresolved")) {
            return "unresolved";
        }
        const channels: Array<Component | null> = components.slice(0, 3) as Array<Component | null>;
        if (!channels.every((channel: Component | null) => channel === null || channel.unit === "" || channel.unit === "%")) {
            return undefined;
        }
        if (modern === undefined && !this.allSameUnit(channels)) {
            return undefined;
        }
        const channel: (component: Component | null) => number | null = (component: Component | null): number | null => {
            if (component === null) {
                return null;
            }
            const scaled: number = component.unit === "%" ? component.value / 100 : component.value / 255;
            return this.clamp(scaled, 0, 1);
        };
        const alpha: number | null | undefined = this.alphaOf(components[3]);
        if (alpha === undefined) {
            return undefined;
        }
        return { kind: "color", space: "srgb", components: [channel(channels[0]), channel(channels[1]), channel(channels[2])], alpha, legacy: true };
    }

    private parseHsl(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 4 §7: legacy syntax takes percentages only, and a negative saturation is clamped to 0% at parsed-value time.
        const modern: Array<ComponentResult> | undefined = this.modernComponents(args, context);
        const components: Array<ComponentResult> | undefined = modern ?? this.legacyComponents(args, context);
        if (components === undefined || components.includes(undefined)) {
            return undefined;
        }
        if (components.includes("unresolved")) {
            return "unresolved";
        }
        const [hue, saturation, lightness]: Array<Component | null> = components as Array<Component | null>;
        if (!this.isHue(hue) || !this.isNumberOrPercentage(saturation) || !this.isNumberOrPercentage(lightness)) {
            return undefined;
        }
        if (modern === undefined && (saturation?.unit !== "%" || lightness?.unit !== "%")) {
            return undefined;
        }
        const alpha: number | null | undefined = this.alphaOf(components[3]);
        if (alpha === undefined) {
            return undefined;
        }
        if (hue === null || saturation === null || lightness === null) {
            // CSS Color 4 §16.2.2: "an hsl() or hwb() value containing none round-trips through serialization in its own color
            // function"; §13.3 carries what is missing through an interpolation.
            const saturated: number | null = saturation === null ? null : Math.max(0, this.bounded(saturation.value));
            return { kind: "color", space: "hsl", components: [this.hueOf(hue), saturated, lightness === null ? null : this.bounded(lightness.value)], alpha, legacy: false };
        }
        const rgb: Triple = this.spaces.hslToSrgb(this.hueOf(hue) ?? 0, Math.max(0, this.bounded(saturation.value)), this.bounded(lightness.value));
        return { kind: "color", space: "srgb", components: rgb, alpha, legacy: true };
    }

    private parseHwb(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 4 §8: modern syntax only.
        const components: Array<ComponentResult> | undefined = this.modernComponents(args, context);
        if (components === undefined || components.includes(undefined)) {
            return undefined;
        }
        if (components.includes("unresolved")) {
            return "unresolved";
        }
        const [hue, white, black]: Array<Component | null> = components as Array<Component | null>;
        if (!this.isHue(hue) || !this.isNumberOrPercentage(white) || !this.isNumberOrPercentage(black)) {
            return undefined;
        }
        const alpha: number | null | undefined = this.alphaOf(components[3]);
        if (alpha === undefined) {
            return undefined;
        }
        if (hue === null || white === null || black === null) {
            return { kind: "color", space: "hwb", components: [this.hueOf(hue), white === null ? null : this.bounded(white.value), black === null ? null : this.bounded(black.value)], alpha, legacy: false };
        }
        const rgb: Triple = this.spaces.hwbToSrgb(this.hueOf(hue) ?? 0, this.bounded(white.value), this.bounded(black.value));
        return { kind: "color", space: "srgb", components: rgb, alpha, legacy: true };
    }

    private parseLab(name: string, args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 4 §9.3 and §9.4: lightness is clamped to its range and chroma to zero or more at parsed-value time.
        const components: Array<ComponentResult> | undefined = this.modernComponents(args, context);
        if (components === undefined || components.includes(undefined)) {
            return undefined;
        }
        if (components.includes("unresolved")) {
            return "unresolved";
        }
        const [first, second, third]: Array<Component | null> = components as Array<Component | null>;
        const polar: boolean = name === "lch" || name === "oklch";
        const ok: boolean = name === "oklab" || name === "oklch";
        if (!this.isNumberOrPercentage(first) || !this.isNumberOrPercentage(second) || !(polar ? this.isHue(third) : this.isNumberOrPercentage(third))) {
            return undefined;
        }
        const alpha: number | null | undefined = this.alphaOf(components[3]);
        if (alpha === undefined) {
            return undefined;
        }
        const lightnessScale: number = ok ? 0.01 : 1;
        const lightness: number | null = first === null ? null : this.clamp(this.scaled(first, lightnessScale), 0, ok ? 1 : 100);
        if (polar) {
            const chromaScale: number = ok ? 0.004 : 1.5;
            const chroma: number | null = second === null ? null : Math.max(0, this.bounded(this.scaled(second, chromaScale)));
            return { kind: "color", space: name as ColorSpace, components: [lightness, chroma, this.hueOf(third)], alpha, legacy: false };
        }
        const axisScale: number = ok ? 0.004 : 1.25;
        const axis: (component: Component | null) => number | null = (component: Component | null): number | null =>
            component === null ? null : this.bounded(this.scaled(component, axisScale));
        return { kind: "color", space: name as ColorSpace, components: [lightness, axis(second), axis(third)], alpha, legacy: false };
    }

    private parseColorFunction(args: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 4 §10.1: color(<predefined-rgb> | <xyz-space> components [/ alpha]), with 100% = 1.0 and no clamping.
        if (args.length !== 1 || args[0].kind !== "list" || args[0].separator !== "space") {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = args[0].items;
        const first: CssValue | undefined = items[0];
        if (first === undefined || first.kind !== "ident") {
            return undefined;
        }
        const space: ColorSpace | undefined = first.name.startsWith("--") ? undefined : PREDEFINED_SPACES.get(first.lower);
        if (space === undefined) {
            return this.parseProfileColor(first.name, items.slice(1), context);
        }
        const components: Array<ComponentResult> | undefined = this.modernComponents([{ kind: "list", separator: "space", items: items.slice(1) }], context);
        if (components === undefined || components.includes(undefined)) {
            return undefined;
        }
        if (components.includes("unresolved")) {
            return "unresolved";
        }
        const channels: Array<Component | null> = components.slice(0, 3) as Array<Component | null>;
        if (!channels.every((channel: Component | null) => this.isNumberOrPercentage(channel))) {
            return undefined;
        }
        const alpha: number | null | undefined = this.alphaOf(components[3]);
        if (alpha === undefined) {
            return undefined;
        }
        const channel: (component: Component | null) => number | null = (component: Component | null): number | null =>
            component === null ? null : this.bounded(this.scaled(component, 0.01));
        return { kind: "color", space, components: [channel(channels[0]), channel(channels[1]), channel(channels[2])], alpha, legacy: false };
    }

    private parseProfileColor(name: string, items: ReadonlyArray<CssValue>, context: CalcContext): ParsedColor | undefined {
        // CSS Color 5 §5.1: the name of a valid color profile and one or more components, which "are clamped to the valid
        // range at computed value time"; the excess ones "are ignored", and "the missing parameters default to 0".
        const count: number | undefined = this.profiles?.channels(name);
        const slash: number = items.findIndex((item: CssValue) => item.kind === "slash");
        const parts: ReadonlyArray<CssValue> = slash === -1 ? items : items.slice(0, slash);
        if (parts.length === 0 || (slash !== -1 && slash !== items.length - 2)) {
            return undefined;
        }
        const components: Array<number | null> = [];
        for (const part of parts.slice(0, count)) {
            const component: ComponentResult = this.component(part, context, true);
            if (component === "unresolved") {
                return "unresolved";
            }
            if (component === undefined || (component !== null && component.unit !== "" && component.unit !== "%")) {
                return undefined;
            }
            components.push(component === null ? null : this.clamp(this.scaled(component, 0.01), 0, 1));
        }
        while (count !== undefined && components.length < count) {
            components.push(0);
        }
        const opacity: ComponentResult = slash === -1 ? { value: 1, unit: "" } : this.component(items[slash + 1], context, true);
        if (opacity === "unresolved") {
            return "unresolved";
        }
        const alpha: number | null | undefined = this.alphaOf(opacity);
        if (alpha === undefined) {
            return undefined;
        }
        // §5.1: a name that matches no color space or no valid profile is an invalid color, not an invalid declaration;
        // CSS Color 4 §10.1: "If the color is an invalid color, the used value is opaque black."
        return count === undefined ? { kind: "color", space: "srgb", components: [0, 0, 0], alpha: 1, legacy: false } : { kind: "profile-color", profile: name, components, alpha };
    }

    private modernComponents(args: ReadonlyArray<CssValue>, context: CalcContext): Array<ComponentResult> | undefined {
        // CSS Color 4 §4.1.1: three space-separated components and an optional alpha after a solidus.
        if (args.length !== 1 || args[0].kind !== "list" || args[0].separator !== "space") {
            return undefined;
        }
        const items: ReadonlyArray<CssValue> = args[0].items;
        if (items.length !== 3 && items.length !== 5) {
            return undefined;
        }
        if (items.length === 5 && items[3].kind !== "slash") {
            return undefined;
        }
        const values: Array<CssValue> = items.length === 5 ? [items[0], items[1], items[2], items[4]] : [items[0], items[1], items[2]];
        if (values.some((item: CssValue) => item.kind === "slash")) {
            return undefined;
        }
        const result: Array<ComponentResult> = values.map((item: CssValue) => this.component(item, context, true));
        if (result.length === 3) {
            result.push({ value: 1, unit: "" });
        }
        return result;
    }

    private legacyComponents(args: ReadonlyArray<CssValue>, context: CalcContext): Array<ComponentResult> | undefined {
        // CSS Color 4 §4.1.2: comma-separated components, without none.
        if (args.length !== 3 && args.length !== 4) {
            return undefined;
        }
        const result: Array<ComponentResult> = args.map((arg: CssValue) => this.component(arg, context, false));
        if (result.length === 3) {
            result.push({ value: 1, unit: "" });
        }
        return result;
    }

    private component(value: CssValue, context: CalcContext, allowNone: boolean): ComponentResult {
        switch (value.kind) {
            case "number":
                return { value: value.value, unit: "" };
            case "percentage":
                return { value: value.value, unit: "%" };
            case "dimension": {
                const degrees: number | undefined = this.units.baseTypeOf(value.unit) === "angle" ? this.units.toCanonical(value.value, value.unit) : undefined;
                return degrees === undefined ? undefined : { value: degrees, unit: "deg" };
            }
            case "ident":
                return allowNone && value.lower === "none" ? null : undefined;
            case "calc":
                return this.calcComponent(value.root, context);
            default:
                return undefined;
        }
    }

    private calcComponent(root: CalcNode, context: CalcContext): ComponentResult {
        // A math function in a component must resolve to a <number>, <percentage> or <angle> (CSS Values 4 §10.9).
        const type: NumericType | undefined = this.types.typeOf(root);
        const category: NumericCategory | undefined = type === undefined ? undefined : this.types.categoryOf(type);
        if (category !== "number" && category !== "percentage" && category !== "angle") {
            return undefined;
        }
        const simplified: CalcNode = this.simplifier.simplify(root, context);
        if (simplified.kind !== "leaf") {
            return "unresolved";
        }
        // CSS Values 4 §10.9.1: NaN and signed zeros do not escape a top-level calculation.
        const value: number = Number.isNaN(simplified.value) || simplified.value === 0 ? 0 : simplified.value;
        return { value, unit: simplified.unit as ComponentUnit };
    }

    private alphaOf(component: ComponentResult): number | null | undefined {
        // CSS Color 4 §4.2: an <alpha-value> outside [0, 1] is clamped at parsed-value time.
        if (component === null) {
            return null;
        }
        if (component === undefined || component === "unresolved" || (component.unit !== "" && component.unit !== "%")) {
            return undefined;
        }
        return this.clamp(component.unit === "%" ? component.value / 100 : component.value, 0, 1);
    }

    private hueOf(component: Component | null): number | null {
        // CSS Color 4 §4.3: a hue is normalized to [0, 360), and an infinite one to 0.
        if (component === null) {
            return null;
        }
        if (!Number.isFinite(component.value)) {
            return 0;
        }
        const normalized: number = ((component.value % 360) + 360) % 360;
        return normalized === 0 ? 0 : normalized;
    }

    private isHue(component: Component | null): boolean {
        return component === null || component.unit === "" || component.unit === "deg";
    }

    private isNumberOrPercentage(component: Component | null): boolean {
        return component === null || component.unit === "" || component.unit === "%";
    }

    private allSameUnit(channels: ReadonlyArray<Component | null>): boolean {
        return channels.every((channel: Component | null) => channel !== null && channel.unit === (channels[0] as Component).unit);
    }

    private scaled(component: Component, percentScale: number): number {
        return component.unit === "%" ? component.value * percentScale : component.value;
    }

    private bounded(value: number): number {
        // CSS Color 4 §15.2 to §15.4 allow an implementation-defined limit for values approaching infinity.
        return this.clamp(value, -UNBOUNDED_LIMIT, UNBOUNDED_LIMIT);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }
}
