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

import type { ColorSpaceResource } from "./PdfColorSpaces.js";
import type { PdfFile } from "./PdfFile.js";
import { PdfSyntax } from "./PdfSyntax.js";

export interface ColorStop {
    offset: number;
    components: ReadonlyArray<number>;
}

export interface ShadingResource {
    key: string;
    object: number;
}

export interface PatternResource {
    key: string;
    object: number;
}

export interface ShadingRepeat {
    from: number;
    to: number;
    reflect: boolean;
}

export class PdfShadings {

    private readonly file: PdfFile;
    private readonly syntax: PdfSyntax = new PdfSyntax();

    constructor(file: PdfFile) {
        this.file = file;
    }

    axial(space: ColorSpaceResource, coordinates: readonly [number, number, number, number], stops: ReadonlyArray<ColorStop>,
        extend: readonly [boolean, boolean], repeat?: ShadingRepeat): ShadingResource {
        // ISO 32000-2 §8.7.4.5.3: a type 2 shading along [x0 y0 x1 y1], with t from 0 to 1 at the two ends, or over the
        // domain of the repetitions.
        return this.shading(2, space, coordinates, stops, extend, repeat);
    }

    radial(space: ColorSpaceResource, coordinates: readonly [number, number, number, number, number, number], stops: ReadonlyArray<ColorStop>,
        extend: readonly [boolean, boolean], repeat?: ShadingRepeat): ShadingResource {
        // §8.7.4.5.4: a type 3 shading between the circles [x0 y0 r0 x1 y1 r1].
        return this.shading(3, space, coordinates, stops, extend, repeat);
    }

    pattern(shading: ShadingResource, matrix: ReadonlyArray<number>): PatternResource {
        // §8.7.3.3: a shading pattern, whose matrix maps the shading space to the default space of the content that uses it.
        const object: number = this.file.add("<< /Type /Pattern /PatternType 2 /Shading " + this.syntax.reference(shading.object) + " /Matrix [" + this.syntax.numbers(matrix) + "] >>");
        return { key: "P" + object, object };
    }

    private shading(type: number, space: ColorSpaceResource, coordinates: ReadonlyArray<number>, stops: ReadonlyArray<ColorStop>,
        extend: readonly [boolean, boolean], repeat?: ShadingRepeat): ShadingResource {
        const domain: string = repeat === undefined ? "" : " /Domain [" + this.syntax.numbers([repeat.from, repeat.to]) + "]";
        const object: number = this.file.add("<< /ShadingType " + type + " /ColorSpace " + space.value + " /Coords [" + this.syntax.numbers(coordinates)
            + "]" + domain + " /Function " + (repeat === undefined ? this.function(stops) : this.repeated(this.function(stops), repeat)) + " /Extend ["
            + extend[0] + " " + extend[1] + "] >>");
        return { key: "Sh" + object, object };
    }

    private repeated(period: string, repeat: ShadingRepeat): string {
        // §7.10.4: one copy of the function for each unit of the domain, every other one encoded backwards when it reflects.
        const pieces: Array<string> = [];
        const bounds: Array<number> = [];
        const encode: Array<number> = [];
        for (let unit: number = repeat.from; unit < repeat.to; unit++) {
            if (unit > repeat.from) {
                bounds.push(unit);
            }
            pieces.push(period);
            const backwards: boolean = repeat.reflect && Math.abs(unit % 2) === 1;
            encode.push(backwards ? 1 : 0, backwards ? 0 : 1);
        }
        return "<< /FunctionType 3 /Domain [" + this.syntax.numbers([repeat.from, repeat.to]) + "] /Functions [" + pieces.join(" ") + "] /Bounds ["
            + this.syntax.numbers(bounds) + "] /Encode [" + this.syntax.numbers(encode) + "] >>";
    }

    private function(stops: ReadonlyArray<ColorStop>): string {
        // §7.10.3: a type 2 function with N 1 is linear between two colours; §7.10.4: a type 3 function joins one for each
        // pair of stops, and its Bounds increase strictly, so a stop at the offset of the one before has no piece of its own.
        const points: Array<ColorStop> = [];
        for (const stop of stops) {
            const offset: number = Math.min(1, Math.max(0, stop.offset));
            const last: ColorStop | undefined = points[points.length - 1];
            if (last !== undefined && offset < last.offset) {
                points.push({ offset: last.offset, components: stop.components });
            } else {
                points.push({ offset, components: stop.components });
            }
        }
        if (points.length === 0) {
            return "<< /FunctionType 2 /Domain [0 1] /N 1 >>";
        }
        if (points[0].offset > 0) {
            points.unshift({ offset: 0, components: points[0].components });
        }
        if (points[points.length - 1].offset < 1) {
            points.push({ offset: 1, components: points[points.length - 1].components });
        }
        const pieces: Array<string> = [];
        const bounds: Array<number> = [];
        for (let index: number = 1; index < points.length; index++) {
            const from: ColorStop = points[index - 1];
            const to: ColorStop = points[index];
            if (to.offset <= from.offset && points.length > 2) {
                continue;
            }
            if (pieces.length > 0) {
                bounds.push(from.offset);
            }
            pieces.push("<< /FunctionType 2 /Domain [0 1] /C0 [" + this.syntax.numbers(from.components) + "] /C1 [" + this.syntax.numbers(to.components) + "] /N 1 >>");
        }
        if (pieces.length === 1) {
            return pieces[0];
        }
        const encode: Array<number> = [];
        for (let index: number = 0; index < pieces.length; index++) {
            encode.push(0, 1);
        }
        return "<< /FunctionType 3 /Domain [0 1] /Functions [" + pieces.join(" ") + "] /Bounds [" + this.syntax.numbers(bounds) + "] /Encode ["
            + this.syntax.numbers(encode) + "] >>";
    }
}
