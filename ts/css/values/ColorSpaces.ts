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

import type { ColorSpace, ColorValue, DeviceCmykValue } from "./CssValue.js";

type Triple = [number, number, number];

type Matrix = readonly [Triple, Triple, Triple];

type Components = readonly [number | null, number | null, number | null];

type WhitePoint = "d50" | "d65";

type TransferFunction = "srgb" | "linear" | "a98" | "prophoto" | "rec2020" | "pq" | "hlg";

interface RgbSpace {
    transfer: TransferFunction;
    toXyz: Matrix;
    fromXyz: Matrix;
    white: WhitePoint;
}

const D50: Triple = [0.3457 / 0.3585, 1.00000, (1.0 - 0.3457 - 0.3585) / 0.3585];

const SRGB_TO_XYZ: Matrix = [
    [506752 / 1228815, 87881 / 245763, 12673 / 70218],
    [87098 / 409605, 175762 / 245763, 12673 / 175545],
    [7918 / 409605, 87881 / 737289, 1001167 / 1053270]
];

const XYZ_TO_SRGB: Matrix = [
    [12831 / 3959, -329 / 214, -1974 / 3959],
    [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
    [705 / 12673, -2585 / 12673, 705 / 667]
];

const P3_TO_XYZ: Matrix = [
    [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
    [35783 / 156275, 247089 / 357200, 198249 / 2500400],
    [0 / 1, 32229 / 714400, 5220557 / 5000800]
];

const XYZ_TO_P3: Matrix = [
    [446124 / 178915, -333277 / 357830, -72051 / 178915],
    [-14852 / 17905, 63121 / 35810, 423 / 17905],
    [11844 / 330415, -50337 / 660830, 316169 / 330415]
];

const PROPHOTO_TO_XYZ: Matrix = [
    [0.79776664490064230, 0.13518129740053308, 0.03134773412839220],
    [0.28807482881940130, 0.71183523424187300, 0.00008993693872564],
    [0.00000000000000000, 0.00000000000000000, 0.82510460251046020]
];

const XYZ_TO_PROPHOTO: Matrix = [
    [1.34578688164715830, -0.25557208737979464, -0.05110186497554526],
    [-0.54463070512490190, 1.50824774284514680, 0.02052744743642139],
    [0.00000000000000000, 0.00000000000000000, 1.21196754563894520]
];

const A98_TO_XYZ: Matrix = [
    [573536 / 994567, 263643 / 1420810, 187206 / 994567],
    [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
    [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835]
];

const XYZ_TO_A98: Matrix = [
    [1829569 / 896150, -506331 / 896150, -308931 / 896150],
    [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
    [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040]
];

const REC2020_TO_XYZ: Matrix = [
    [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
    [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
    [0 / 1, 19567812 / 697040785, 295819943 / 278816314]
];

const XYZ_TO_REC2020: Matrix = [
    [30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100],
    [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200],
    [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125]
];

const D65_TO_D50: Matrix = [
    [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
    [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
    [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371]
];

const D50_TO_D65: Matrix = [
    [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
    [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
    [0.012314014864481998, -0.020507649298898964, 1.330365926242124]
];

const XYZ_TO_LMS: Matrix = [
    [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
    [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
    [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]
];

const LMS_TO_OKLAB: Matrix = [
    [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
    [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
    [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]
];

const LMS_TO_XYZ: Matrix = [
    [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
    [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164],
    [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]
];

const OKLAB_TO_LMS: Matrix = [
    [1.0000000000000000, 0.3963377773761749, 0.2158037573099136],
    [1.0000000000000000, -0.1055613458156586, -0.0638541728258133],
    [1.0000000000000000, -0.0894841775298119, -1.2914855480194092]
];

const RGB_SPACES: ReadonlyMap<ColorSpace, RgbSpace> = new Map<ColorSpace, RgbSpace>([
    ["srgb", { transfer: "srgb", toXyz: SRGB_TO_XYZ, fromXyz: XYZ_TO_SRGB, white: "d65" }],
    ["srgb-linear", { transfer: "linear", toXyz: SRGB_TO_XYZ, fromXyz: XYZ_TO_SRGB, white: "d65" }],
    ["display-p3", { transfer: "srgb", toXyz: P3_TO_XYZ, fromXyz: XYZ_TO_P3, white: "d65" }],
    ["display-p3-linear", { transfer: "linear", toXyz: P3_TO_XYZ, fromXyz: XYZ_TO_P3, white: "d65" }],
    ["a98-rgb", { transfer: "a98", toXyz: A98_TO_XYZ, fromXyz: XYZ_TO_A98, white: "d65" }],
    ["prophoto-rgb", { transfer: "prophoto", toXyz: PROPHOTO_TO_XYZ, fromXyz: XYZ_TO_PROPHOTO, white: "d50" }],
    ["rec2020", { transfer: "rec2020", toXyz: REC2020_TO_XYZ, fromXyz: XYZ_TO_REC2020, white: "d65" }],
    ["rec2100-linear", { transfer: "linear", toXyz: REC2020_TO_XYZ, fromXyz: XYZ_TO_REC2020, white: "d65" }],
    ["rec2100-pq", { transfer: "pq", toXyz: REC2020_TO_XYZ, fromXyz: XYZ_TO_REC2020, white: "d65" }],
    ["rec2100-hlg", { transfer: "hlg", toXyz: REC2020_TO_XYZ, fromXyz: XYZ_TO_REC2020, white: "d65" }]
]);

const REFERENCE_WHITE: number = 203;
const PEAK_LUMINANCE: number = 10000;
const PQ_C1: number = 3424 / 4096;
const PQ_C2: number = 2413 / 128;
const PQ_C3: number = 2392 / 128;
const PQ_N: number = 2610 / 16384;
const PQ_M: number = 2523 / 32;
const HLG_A: number = 0.17883277;
const HLG_B: number = 0.28466892;
const HLG_C: number = 0.55991073;
const HLG_SCALE: number = 3.7743;

const XYZ_TO_ICTCP_LMS: Matrix = [
    [0.3592832590121217, 0.6976051147779502, -0.0358915932320290],
    [-0.1920808463704993, 1.1004767970374321, 0.0753748658519118],
    [0.0070797844607479, 0.0748396662186362, 0.8433265453898765]
];

const LMS_TO_ICTCP: Matrix = [
    [2048 / 4096, 2048 / 4096, 0],
    [6610 / 4096, -13613 / 4096, 7003 / 4096],
    [17933 / 4096, -17390 / 4096, -543 / 4096]
];

const ICTCP_TO_LMS: Matrix = [
    [0.9999999999999998, 0.0086090370379328, 0.1110296250030260],
    [0.9999999999999998, -0.0086090370379328, -0.1110296250030259],
    [0.9999999999999998, 0.5600313357106791, -0.3206271749873188]
];

const ICTCP_LMS_TO_XYZ: Matrix = [
    [2.0701522183894223, -1.3263473389671563, 0.2066510476294053],
    [0.3647385209748072, 0.6805660249472273, -0.0453045459220347],
    [-0.0497472075358123, -0.0492609666966131, 1.1880659249923042]
];

const XYZ_TO_JZ_LMS: Matrix = [
    [0.41478972, 0.579999, 0.0146480],
    [-0.2015100, 1.120649, 0.0531008],
    [-0.0166008, 0.264800, 0.6684799]
];

const JZ_LMS_TO_JZAZBZ: Matrix = [
    [0.5, 0.5, 0],
    [3.524000, -4.066708, 0.542708],
    [0.199076, 1.096799, -1.295875]
];

const JZAZBZ_TO_JZ_LMS: Matrix = [
    [1, 0.13860504327153927, 0.05804731615611883],
    [1, -0.1386050432715393, -0.058047316156118904],
    [1, -0.09601924202631895, -0.81189189605603900]
];

const JZ_LMS_TO_XYZ: Matrix = [
    [1.9242264357876067, -1.0047923125953657, 0.037651404030618],
    [0.35031676209499907, 0.7264811939316552, -0.06538442294808501],
    [-0.09098281098284752, -0.3127282905230739, 1.5227665613052603]
];

const JZ_B: number = 1.15;
const JZ_G: number = 0.66;
const JZ_D: number = -0.56;
const JZ_D0: number = 1.6295499532821566e-11;
const JZ_P: number = 1.7 * 2523 / 32;
const JZCZHZ_POWERLESS: number = 0.0000026;

const RGB_CHANNELS: ReadonlyArray<string> = ["r", "g", "b"];
const RGB_CATEGORIES: ReadonlyArray<string> = ["red", "green", "blue"];
const COMPONENT_CATEGORIES: ReadonlyMap<ColorSpace, ReadonlyArray<string>> = new Map<ColorSpace, ReadonlyArray<string>>([
    ["lab", ["lightness", "a", "b"]], ["oklab", ["lightness", "a", "b"]], ["lch", ["lightness", "colorfulness", "hue"]],
    ["oklch", ["lightness", "colorfulness", "hue"]], ["hsl", ["hue", "colorfulness", "lightness"]], ["hwb", ["hue", "", ""]],
    ["ictcp", ["", "", ""]], ["jzazbz", ["", "", ""]], ["jzczhz", ["", "", ""]]
]);
const HUE_INDEXES: ReadonlyMap<ColorSpace, number> = new Map<ColorSpace, number>([["lch", 2], ["oklch", 2], ["hsl", 0], ["hwb", 0], ["jzczhz", 2]]);

const LAB_EPSILON: number = 216 / 24389;
const LAB_KAPPA: number = 24389 / 27;
const LCH_POWERLESS: number = 0.0015;
const OKLCH_POWERLESS: number = 0.000004;
const HSL_POWERLESS: number = 0.001;
const HWB_POWERLESS: number = 99.999;
const RAY_EPSILON: number = 1e-12;

export class ColorSpaces {

    static readonly XYZ_CHANNELS: ReadonlyArray<string> = ["x", "y", "z"];
    static readonly ALPHA_CHANNEL: string = "alpha";
    static readonly PROFILE_CHANNELS: ReadonlySet<string> = new Set<string>();
    static readonly CHANNELS: ReadonlyMap<string, ReadonlyArray<string>> = new Map<string, ReadonlyArray<string>>([
        ["rgb", RGB_CHANNELS], ["rgba", RGB_CHANNELS], ["hsl", ["h", "s", "l"]], ["hsla", ["h", "s", "l"]], ["hwb", ["h", "w", "b"]],
        ["lab", ["l", "a", "b"]], ["oklab", ["l", "a", "b"]], ["lch", ["l", "c", "h"]], ["oklch", ["l", "c", "h"]], ["color", RGB_CHANNELS], ["alpha", []],
        ["ictcp", ["i", "ct", "cp"]], ["jzazbz", ["j", "a", "b"]], ["jzczhz", ["j", "c", "h"]]
    ]);

    convert(color: ColorValue, destination: ColorSpace): ColorValue {
        // CSS Color 4 §11.2, "convert a color".
        if (color.space === destination) {
            return color;
        }
        const prepared: { space: ColorSpace; components: Components } = this.prepare(color);
        const rectangular: Triple = [prepared.components[0] ?? 0, prepared.components[1] ?? 0, prepared.components[2] ?? 0];
        if (prepared.space === destination) {
            // The matrices to XYZ and back are not exact inverses, and with nothing left to convert they only add error.
            return { kind: "color", space: destination, components: rectangular, alpha: color.alpha, legacy: false };
        }
        const source: { xyz: Triple; white: WhitePoint } = this.toXyz(prepared.space, rectangular);
        const destinationRectangular: ColorSpace = this.rectangularOf(destination);
        const destinationWhite: WhitePoint = this.whiteOf(destinationRectangular);
        const xyz: Triple = source.white === destinationWhite ? source.xyz : this.multiply(source.white === "d65" ? D65_TO_D50 : D50_TO_D65, source.xyz);
        const converted: Triple = this.fromXyz(destinationRectangular, xyz);
        const components: Components = destination === destinationRectangular ? converted : this.toPolar(destination, converted);
        return { kind: "color", space: destination, components, alpha: color.alpha, legacy: false };
    }

    isInGamut(color: ColorValue, destination: ColorSpace): boolean {
        const converted: ColorValue = this.convert(color, destination);
        return converted.components.every((component: number | null) => component === null || (component >= 0 && component <= 1));
    }

    gamutMap(origin: ColorValue, destination: ColorSpace): ColorValue {
        // CSS Color 4 §14.2.6, ray trace gamut mapping: of the algorithms of §14.2 the one with a fixed number of steps, which
        // a PDF calculator function, having no loops, also runs, so solid colors and gradients are mapped alike.
        const rgb: RgbSpace | undefined = RGB_SPACES.get(destination);
        if (rgb === undefined || this.isInGamut(origin, destination)) {
            return this.convert(origin, destination);
        }
        const oklab: Components = this.convert(origin, "oklab").components;
        const lightness: number = oklab[0] ?? 0;
        if (lightness >= 1 || lightness <= 0) {
            return this.convert({ kind: "color", space: "oklab", components: [lightness >= 1 ? 1 : 0, 0, 0], alpha: origin.alpha, legacy: false }, destination);
        }
        const mapped: Triple = this.fromLinear(rgb.transfer, this.rayTrace([lightness, oklab[1] ?? 0, oklab[2] ?? 0], rgb));
        const clamp: (value: number) => number = (value: number): number => Math.min(1, Math.max(0, value));
        return { kind: "color", space: destination, components: [clamp(mapped[0]), clamp(mapped[1]), clamp(mapped[2])], alpha: origin.alpha, legacy: false };
    }

    private rayTrace(origin: Triple, rgb: RgbSpace): Triple {
        // §14.2.6: a ray from the achromatic anchor to the color meets the cube of the linear-light space, the crossing is put
        // back on the line of the origin's lightness and hue, and the ray is cast again, four times at most.
        const [lightness, a, b]: Triple = origin;
        const chroma: number = Math.hypot(a, b);
        let anchor: Triple = this.oklabToLinear([lightness, 0, 0], rgb);
        let current: Triple = this.oklabToLinear(origin, rgb);
        let last: Triple = current;
        for (let step: number = 0; step < 4; step++) {
            if (step > 0) {
                const corrected: Triple = this.linearToOklab(current, rgb);
                const scale: number = chroma > 0 ? Math.hypot(corrected[1], corrected[2]) / chroma : 0;
                current = this.oklabToLinear([lightness, a * scale, b * scale], rgb);
            }
            const intersection: Triple | undefined = this.castRay(anchor, current);
            if (intersection === undefined) {
                current = last;
                break;
            }
            if (step > 0 && current.every((value: number) => value > RAY_EPSILON && value < 1 - RAY_EPSILON)) {
                anchor = current;
            }
            current = intersection;
            last = intersection;
        }
        return current;
    }

    private castRay(start: Triple, end: Triple): Triple | undefined {
        // §14.2.6, "cast a ray" through the cube from 0 to 1, the first crossing in the direction from start to end.
        let near: number = Number.NEGATIVE_INFINITY;
        let far: number = Number.POSITIVE_INFINITY;
        const direction: Triple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
        for (let channel: number = 0; channel < 3; channel++) {
            const from: number = start[channel];
            const d: number = direction[channel];
            if (Math.abs(d) > RAY_EPSILON) {
                const first: number = -from / d;
                const second: number = (1 - from) / d;
                near = Math.max(Math.min(first, second), near);
                far = Math.min(Math.max(first, second), far);
            } else if (from < 0 || from > 1) {
                return undefined;
            }
        }
        if (near > far || far < 0) {
            return undefined;
        }
        if (near < 0) {
            near = far;
        }
        if (!Number.isFinite(near)) {
            return undefined;
        }
        return [start[0] + direction[0] * near, start[1] + direction[1] * near, start[2] + direction[2] * near];
    }

    private oklabToLinear(oklab: Triple, rgb: RgbSpace): Triple {
        const xyz: Triple = this.oklabToXyz(oklab);
        return this.multiply(rgb.fromXyz, rgb.white === "d50" ? this.multiply(D65_TO_D50, xyz) : xyz);
    }

    private linearToOklab(linear: Triple, rgb: RgbSpace): Triple {
        const xyz: Triple = this.multiply(rgb.toXyz, linear);
        return this.xyzToOklab(rgb.white === "d50" ? this.multiply(D50_TO_D65, xyz) : xyz);
    }

    interpolate(first: ColorValue, second: ColorValue, space: ColorSpace, hueMethod: string, progress: number): ColorValue {
        // CSS Color 4 §13: each color is converted with its missing components carried forward, a missing component takes the
        // other color's value, the hues are fixed up, and the premultiplied components are interpolated.
        const start: ColorValue = this.carriedForward(first, space);
        const end: ColorValue = this.carriedForward(second, space);
        const startAlpha: number | null = start.alpha ?? end.alpha;
        const endAlpha: number | null = end.alpha ?? start.alpha;
        const alpha: number | null = startAlpha === null || endAlpha === null ? null : startAlpha + (endAlpha - startAlpha) * progress;
        const hueIndex: number = HUE_INDEXES.get(space) ?? -1;
        const components: Array<number | null> = [];
        for (let index: number = 0; index < 3; index++) {
            const from: number | null = start.components[index] ?? end.components[index];
            const to: number | null = end.components[index] ?? start.components[index];
            if (from === null || to === null) {
                components.push(null);
            } else if (index === hueIndex) {
                const hues: [number, number] = this.fixedUpHues(from, to, hueMethod);
                components.push((((hues[0] + (hues[1] - hues[0]) * progress) % 360) + 360) % 360);
            } else {
                // §13.4: the hue is not premultiplied, a missing alpha premultiplies nothing, and with an interpolated alpha
                // of zero or none the un-premultiplied value is the premultiplied one.
                const value: number = from * (startAlpha ?? 1) + (to * (endAlpha ?? 1) - from * (startAlpha ?? 1)) * progress;
                components.push(alpha === null || alpha === 0 ? value : value / alpha);
            }
        }
        return { kind: "color", space, components: [components[0], components[1], components[2]], alpha, legacy: false };
    }

    headroomColor(first: ColorValue, firstHeadroom: number, second: ColorValue, secondHeadroom: number, headroom: number): ColorValue {
        // CSS Color HDR 1 §5.1: both colors in absolute D65 XYZ, which is xyz-d65 by 203, weighted by where the headroom of
        // the output lies between theirs, with "eps = 0.001" against a division by zero.
        const one: ColorValue = this.convert(first, "xyz-d65");
        const two: ColorValue = this.convert(second, "xyz-d65");
        const firstWeight: number = Math.min(1, Math.max(0, (headroom - secondHeadroom) / (firstHeadroom - secondHeadroom)));
        const secondWeight: number = Math.min(1, Math.max(0, (headroom - firstHeadroom) / (secondHeadroom - firstHeadroom)));
        const component: (index: number) => number = (index: number): number =>
            (Math.pow((one.components[index] ?? 0) * REFERENCE_WHITE + 0.001, firstWeight) * Math.pow((two.components[index] ?? 0) * REFERENCE_WHITE + 0.001, secondWeight) - 0.001) / REFERENCE_WHITE;
        const alpha: number = (first.alpha ?? 0) * firstWeight + (second.alpha ?? 0) * secondWeight;
        return { kind: "color", space: "xyz-d65", components: [component(0), component(1), component(2)], alpha, legacy: false };
    }

    cmykToSrgb(color: DeviceCmykValue): ColorValue {
        // CSS Color 5 §6.1, "naively convert from CMYK to RGBA"; a missing ink counts as none of it.
        const black: number = color.components[3] ?? 0;
        const channel: (ink: number | null) => number = (ink: number | null): number => 1 - Math.min(1, (ink ?? 0) * (1 - black) + black);
        return {
            kind: "color", space: "srgb", components: [channel(color.components[0]), channel(color.components[1]), channel(color.components[2])],
            alpha: color.alpha, legacy: false
        };
    }

    carriedForward(color: ColorValue, space: ColorSpace): ColorValue {
        // CSS Color 4 §13.3: a missing component stays missing in its analogous component of the interpolation space, and
        // so does the set of the components that have no analog when every one of them is missing.
        if (color.space === space) {
            return color;
        }
        const source: ReadonlyArray<string> = COMPONENT_CATEGORIES.get(color.space) ?? RGB_CATEGORIES;
        const target: ReadonlyArray<string> = COMPONENT_CATEGORIES.get(space) ?? RGB_CATEGORIES;
        const missing: Array<boolean> = [false, false, false];
        const analogous: Array<boolean> = [false, false, false];
        const matched: Array<boolean> = [false, false, false];
        for (let index: number = 0; index < 3; index++) {
            const sourceIndex: number = target[index] === "" ? -1 : source.indexOf(target[index]);
            if (sourceIndex !== -1) {
                analogous[index] = true;
                matched[sourceIndex] = true;
                missing[index] = color.components[sourceIndex] === null;
            }
        }
        const rest: Array<number> = [0, 1, 2].filter((index: number) => !matched[index]);
        const restMissing: boolean = rest.length > 0 && rest.every((index: number) => color.components[index] === null);
        const converted: Components = this.convert(color, space).components;
        const component: (index: number) => number | null = (index: number): number | null =>
            missing[index] || (restMissing && !analogous[index]) ? null : converted[index];
        return { kind: "color", space, components: [component(0), component(1), component(2)], alpha: color.alpha, legacy: false };
    }

    hueIndex(space: ColorSpace): number | undefined {
        return HUE_INDEXES.get(space);
    }

    fixedUpHues(first: number, second: number, method: string): [number, number] {
        // CSS Color 4 §13.5.1 to §13.5.4.
        const difference: number = second - first;
        switch (method) {
            case "longer":
                if (difference > 0 && difference < 180) {
                    return [first + 360, second];
                }
                return difference > -180 && difference <= 0 ? [first, second + 360] : [first, second];
            case "increasing":
                return second < first ? [first, second + 360] : [first, second];
            case "decreasing":
                return first < second ? [first + 360, second] : [first, second];
            default:
                if (difference > 180) {
                    return [first + 360, second];
                }
                return difference < -180 ? [first, second + 360] : [first, second];
        }
    }

    private withPowerlessMissing(color: ColorValue): ColorValue {
        // CSS Color 4 §4.4.1: a powerless hue becomes missing, and a colorfulness within ε of zero becomes zero.
        const [first, second, third]: Components = color.components;
        switch (color.space) {
            case "hsl":
                return second !== null && second <= HSL_POWERLESS ? { ...color, components: [null, second > 0 ? 0 : second, third] } : color;
            case "lch":
                return second !== null && second <= LCH_POWERLESS ? { ...color, components: [first, second > 0 ? 0 : second, null] } : color;
            case "oklch":
                return second !== null && second <= OKLCH_POWERLESS ? { ...color, components: [first, second > 0 ? 0 : second, null] } : color;
            case "jzczhz":
                return second !== null && second <= JZCZHZ_POWERLESS ? { ...color, components: [first, second > 0 ? 0 : second, null] } : color;
            case "hwb":
                return second !== null && third !== null && second + third >= HWB_POWERLESS ? { ...color, components: [null, second, second + third < 100 ? 100 - second : third] } : color;
            default:
                return color;
        }
    }

    hslToSrgb(hue: number, saturation: number, lightness: number): Triple {
        // CSS Color 4 §7.1.
        const s: number = saturation / 100;
        const l: number = lightness / 100;
        const f: (n: number) => number = (n: number): number => {
            const k: number = (n + hue / 30) % 12;
            const a: number = s * Math.min(l, 1 - l);
            return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        };
        return [f(0), f(8), f(4)];
    }

    hwbToSrgb(hue: number, white: number, black: number): Triple {
        // CSS Color 4 §8.1.
        const w: number = white / 100;
        const b: number = black / 100;
        if (w + b >= 1) {
            const gray: number = w / (w + b);
            return [gray, gray, gray];
        }
        const rgb: Triple = this.hslToSrgb(hue, 100, 50);
        return [rgb[0] * (1 - w - b) + w, rgb[1] * (1 - w - b) + w, rgb[2] * (1 - w - b) + w];
    }

    private prepare(color: ColorValue): { space: ColorSpace; components: Components } {
        // CSS Color 4 §11.2, "prepare a color for conversion": powerless components become missing, then polar coordinates become rectangular.
        const prepared: ColorValue = this.withPowerlessMissing(color);
        const [first, second, third]: Components = prepared.components;
        switch (prepared.space) {
            case "hsl":
                return { space: "srgb", components: this.hslToSrgb(first ?? 0, second ?? 0, third ?? 0) };
            case "hwb":
                return { space: "srgb", components: this.hwbToSrgb(first ?? 0, second ?? 0, third ?? 0) };
            case "lch":
                return { space: "lab", components: this.polarToRectangular(first, second, third) };
            case "oklch":
                return { space: "oklab", components: this.polarToRectangular(first, second, third) };
            case "jzczhz":
                return { space: "jzazbz", components: this.polarToRectangular(first, second, third) };
            default:
                return { space: prepared.space, components: prepared.components };
        }
    }

    private polarToRectangular(lightness: number | null, chroma: number | null, hue: number | null): Components {
        // CSS Color 4 §9.6: a missing hue gives a = b = 0.
        if (hue === null) {
            return [lightness, 0, 0];
        }
        const c: number = chroma ?? 0;
        return [lightness, c * Math.cos(hue * Math.PI / 180), c * Math.sin(hue * Math.PI / 180)];
    }

    private toPolar(destination: ColorSpace, rectangular: Triple): Components {
        switch (destination) {
            case "hsl":
                return this.srgbToHsl(rectangular);
            case "hwb":
                return this.srgbToHwb(rectangular);
            case "lch":
                return this.rectangularToPolar(rectangular, LCH_POWERLESS);
            case "jzczhz":
                return this.rectangularToPolar(rectangular, JZCZHZ_POWERLESS);
            default:
                return this.rectangularToPolar(rectangular, OKLCH_POWERLESS);
        }
    }

    private rectangularToPolar(rectangular: Triple, epsilon: number): Components {
        // CSS Color 4 §9.5 and §4.4.1.
        const chroma: number = Math.sqrt(rectangular[1] * rectangular[1] + rectangular[2] * rectangular[2]);
        if (chroma <= epsilon) {
            return [rectangular[0], chroma > 0 ? 0 : chroma, null];
        }
        let hue: number = Math.atan2(rectangular[2], rectangular[1]) * 180 / Math.PI;
        if (hue < 0) {
            hue += 360;
        }
        return [rectangular[0], chroma, hue];
    }

    private srgbToHsl(rgb: Triple): Components {
        // CSS Color 4 §7.2.
        const [red, green, blue]: Triple = rgb;
        const max: number = Math.max(red, green, blue);
        const min: number = Math.min(red, green, blue);
        const light: number = (min + max) / 2;
        const d: number = max - min;
        let hue: number = Number.NaN;
        let sat: number = 0;
        if (d !== 0) {
            sat = light === 0 || light === 1 ? 0 : (max - light) / Math.min(light, 1 - light);
            hue = this.hueOf(red, green, blue, max, d);
        }
        if (sat < 0) {
            hue += 180;
            sat = Math.abs(sat);
        }
        if (hue >= 360) {
            hue -= 360;
        }
        if (sat <= HSL_POWERLESS / 100) {
            return [null, sat > 0 ? 0 : sat * 100, light * 100];
        }
        return [Number.isNaN(hue) ? null : hue, sat * 100, light * 100];
    }

    private srgbToHwb(rgb: Triple): Components {
        // CSS Color 4 §8.2 and §4.4.1.
        const [red, green, blue]: Triple = rgb;
        const max: number = Math.max(red, green, blue);
        const min: number = Math.min(red, green, blue);
        const d: number = max - min;
        let hue: number = d === 0 ? Number.NaN : this.hueOf(red, green, blue, max, d);
        if (hue >= 360) {
            hue -= 360;
        }
        const white: number = min * 100;
        const black: number = (1 - max) * 100;
        if (white + black >= HWB_POWERLESS) {
            return [null, white, white + black < 100 ? 100 - white : black];
        }
        return [Number.isNaN(hue) ? null : hue, white, black];
    }

    private hueOf(red: number, green: number, blue: number, max: number, d: number): number {
        let hue: number;
        if (max === red) {
            hue = (green - blue) / d + (green < blue ? 6 : 0);
        } else if (max === green) {
            hue = (blue - red) / d + 2;
        } else {
            hue = (red - green) / d + 4;
        }
        return hue * 60;
    }

    private rectangularOf(space: ColorSpace): ColorSpace {
        switch (space) {
            case "hsl":
            case "hwb":
                return "srgb";
            case "lch":
                return "lab";
            case "oklch":
                return "oklab";
            case "jzczhz":
                return "jzazbz";
            default:
                return space;
        }
    }

    private whiteOf(space: ColorSpace): WhitePoint {
        if (space === "lab" || space === "xyz-d50") {
            return "d50";
        }
        const rgb: RgbSpace | undefined = RGB_SPACES.get(space);
        return rgb === undefined ? "d65" : rgb.white;
    }

    private toXyz(space: ColorSpace, components: Triple): { xyz: Triple; white: WhitePoint } {
        const rgb: RgbSpace | undefined = RGB_SPACES.get(space);
        if (rgb !== undefined) {
            return { xyz: this.multiply(rgb.toXyz, this.toLinear(rgb.transfer, components)), white: rgb.white };
        }
        switch (space) {
            case "xyz-d50":
                return { xyz: components, white: "d50" };
            case "lab":
                return { xyz: this.labToXyz(components), white: "d50" };
            case "oklab":
                return { xyz: this.oklabToXyz(components), white: "d65" };
            case "ictcp":
                return { xyz: this.ictcpToXyz(components), white: "d65" };
            case "jzazbz":
                return { xyz: this.jzazbzToXyz(components), white: "d65" };
            default:
                return { xyz: components, white: "d65" };
        }
    }

    private fromXyz(space: ColorSpace, xyz: Triple): Triple {
        const rgb: RgbSpace | undefined = RGB_SPACES.get(space);
        if (rgb !== undefined) {
            return this.fromLinear(rgb.transfer, this.multiply(rgb.fromXyz, xyz));
        }
        switch (space) {
            case "lab":
                return this.xyzToLab(xyz);
            case "oklab":
                return this.xyzToOklab(xyz);
            case "ictcp":
                return this.xyzToIctcp(xyz);
            case "jzazbz":
                return this.xyzToJzazbz(xyz);
            default:
                return xyz;
        }
    }

    private toLinear(transfer: TransferFunction, components: Triple): Triple {
        // CSS Color 4 §19: the transfer functions are extended to negative values by reflection.
        return components.map((value: number): number => {
            const sign: number = value < 0 ? -1 : 1;
            const abs: number = Math.abs(value);
            switch (transfer) {
                case "srgb":
                    return abs <= 0.04045 ? value / 12.92 : sign * Math.pow((abs + 0.055) / 1.055, 2.4);
                case "a98":
                    return sign * Math.pow(abs, 563 / 256);
                case "prophoto":
                    return abs <= 16 / 512 ? value / 16 : sign * Math.pow(abs, 1.8);
                case "rec2020":
                    return sign * Math.pow(abs, 2.4);
                case "pq": {
                    // CSS Color HDR 1 §8.1: the PQ transfer function, with HDR Reference White at 203 cd/m² as 1.
                    const root: number = Math.pow(abs, 1 / PQ_M);
                    return sign * Math.pow(Math.max(root - PQ_C1, 0) / (PQ_C2 - PQ_C3 * root), 1 / PQ_N) * PEAK_LUMINANCE / REFERENCE_WHITE;
                }
                case "hlg":
                    // CSS Color HDR 1 §8.2: the HLG transfer function, scaled so that media white is at 0.75.
                    return sign * (abs <= 0.5 ? abs * abs / 3 : (Math.exp((abs - HLG_C) / HLG_A) + HLG_B) / 12) * HLG_SCALE;
                default:
                    return value;
            }
        }) as Triple;
    }

    private fromLinear(transfer: TransferFunction, components: Triple): Triple {
        return components.map((value: number): number => {
            const sign: number = value < 0 ? -1 : 1;
            const abs: number = Math.abs(value);
            switch (transfer) {
                case "srgb":
                    return abs > 0.0031308 ? sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : 12.92 * value;
                case "a98":
                    return sign * Math.pow(abs, 256 / 563);
                case "prophoto":
                    return abs >= 1 / 512 ? sign * Math.pow(abs, 1 / 1.8) : 16 * value;
                case "rec2020":
                    return sign * Math.pow(abs, 1 / 2.4);
                case "pq":
                    return sign * this.perceptualQuantizer(abs * REFERENCE_WHITE, PQ_M);
                case "hlg": {
                    const scaled: number = abs / HLG_SCALE;
                    return sign * (scaled <= 1 / 12 ? Math.sqrt(3 * scaled) : HLG_A * Math.log(12 * scaled - HLG_B) + HLG_C);
                }
                default:
                    return value;
            }
        }) as Triple;
    }

    private xyzToLab(xyz: Triple): Triple {
        const f: Array<number> = xyz.map((value: number, index: number): number => {
            const scaled: number = value / D50[index];
            return scaled > LAB_EPSILON ? Math.cbrt(scaled) : (LAB_KAPPA * scaled + 16) / 116;
        });
        return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
    }

    private labToXyz(lab: Triple): Triple {
        const f1: number = (lab[0] + 16) / 116;
        const f0: number = lab[1] / 500 + f1;
        const f2: number = f1 - lab[2] / 200;
        const xyz: Triple = [
            Math.pow(f0, 3) > LAB_EPSILON ? Math.pow(f0, 3) : (116 * f0 - 16) / LAB_KAPPA,
            lab[0] > LAB_KAPPA * LAB_EPSILON ? Math.pow((lab[0] + 16) / 116, 3) : lab[0] / LAB_KAPPA,
            Math.pow(f2, 3) > LAB_EPSILON ? Math.pow(f2, 3) : (116 * f2 - 16) / LAB_KAPPA
        ];
        return [xyz[0] * D50[0], xyz[1] * D50[1], xyz[2] * D50[2]];
    }

    private xyzToOklab(xyz: Triple): Triple {
        const lms: Triple = this.multiply(XYZ_TO_LMS, xyz);
        return this.multiply(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
    }

    private oklabToXyz(oklab: Triple): Triple {
        const lms: Triple = this.multiply(OKLAB_TO_LMS, oklab);
        return this.multiply(LMS_TO_XYZ, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
    }

    private perceptualQuantizer(luminance: number, exponent: number): number {
        // SMPTE ST 2084 as CSS Color HDR 1 §11 writes it: an absolute luminance up to 10 000 cd/m² as a value from 0 to 1.
        const sign: number = luminance < 0 ? -1 : 1;
        const power: number = Math.pow(Math.abs(luminance) / PEAK_LUMINANCE, PQ_N);
        return sign * Math.pow((PQ_C1 + PQ_C2 * power) / (1 + PQ_C3 * power), exponent);
    }

    private inversePerceptualQuantizer(value: number, exponent: number): number {
        const sign: number = value < 0 ? -1 : 1;
        const root: number = Math.pow(Math.abs(value), 1 / exponent);
        return sign * PEAK_LUMINANCE * Math.pow(Math.max(root - PQ_C1, 0) / (PQ_C2 - PQ_C3 * root), 1 / PQ_N);
    }

    private xyzToIctcp(xyz: Triple): Triple {
        // CSS Color HDR 1 §6.3 and §11.5: absolute D65 XYZ to LMS with the crosstalk built in, PQ, then I, Ct and Cp.
        const lms: Triple = this.multiply(XYZ_TO_ICTCP_LMS, [xyz[0] * REFERENCE_WHITE, xyz[1] * REFERENCE_WHITE, xyz[2] * REFERENCE_WHITE]);
        return this.multiply(LMS_TO_ICTCP, [this.perceptualQuantizer(lms[0], PQ_M), this.perceptualQuantizer(lms[1], PQ_M), this.perceptualQuantizer(lms[2], PQ_M)]);
    }

    private ictcpToXyz(ictcp: Triple): Triple {
        const encoded: Triple = this.multiply(ICTCP_TO_LMS, ictcp);
        const lms: Triple = [this.inversePerceptualQuantizer(encoded[0], PQ_M), this.inversePerceptualQuantizer(encoded[1], PQ_M), this.inversePerceptualQuantizer(encoded[2], PQ_M)];
        const absolute: Triple = this.multiply(ICTCP_LMS_TO_XYZ, lms);
        return [absolute[0] / REFERENCE_WHITE, absolute[1] / REFERENCE_WHITE, absolute[2] / REFERENCE_WHITE];
    }

    private xyzToJzazbz(xyz: Triple): Triple {
        // CSS Color HDR 1 §6.4 and §11.4: absolute D65 XYZ, X and Y modified against the curvature of blue, LMS, a PQ
        // with a scaled exponent, then Iz, az and bz, and Jz from Iz.
        const [x, y, z]: Triple = [xyz[0] * REFERENCE_WHITE, xyz[1] * REFERENCE_WHITE, xyz[2] * REFERENCE_WHITE];
        const lms: Triple = this.multiply(XYZ_TO_JZ_LMS, [JZ_B * x - (JZ_B - 1) * z, JZ_G * y - (JZ_G - 1) * x, z]);
        const [iz, az, bz]: Triple = this.multiply(JZ_LMS_TO_JZAZBZ, [this.perceptualQuantizer(lms[0], JZ_P), this.perceptualQuantizer(lms[1], JZ_P), this.perceptualQuantizer(lms[2], JZ_P)]);
        return [(1 + JZ_D) * iz / (1 + JZ_D * iz) - JZ_D0, az, bz];
    }

    private jzazbzToXyz(jzazbz: Triple): Triple {
        const iz: number = (jzazbz[0] + JZ_D0) / (1 + JZ_D - JZ_D * (jzazbz[0] + JZ_D0));
        const encoded: Triple = this.multiply(JZAZBZ_TO_JZ_LMS, [iz, jzazbz[1], jzazbz[2]]);
        const lms: Triple = [this.inversePerceptualQuantizer(encoded[0], JZ_P), this.inversePerceptualQuantizer(encoded[1], JZ_P), this.inversePerceptualQuantizer(encoded[2], JZ_P)];
        const [xm, ym, z]: Triple = this.multiply(JZ_LMS_TO_XYZ, lms);
        const x: number = (xm + (JZ_B - 1) * z) / JZ_B;
        const y: number = (ym + (JZ_G - 1) * x) / JZ_G;
        return [x / REFERENCE_WHITE, y / REFERENCE_WHITE, z / REFERENCE_WHITE];
    }

    private multiply(matrix: Matrix, vector: Triple): Triple {
        return [
            matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
            matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
            matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
        ];
    }
}
