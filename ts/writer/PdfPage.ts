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

import { ContentStream } from "./ContentStream.js";
import type { ColorSpaceResource } from "./PdfColorSpaces.js";
import type { FontResource } from "./PdfFont.js";
import type { PatternResource, ShadingResource } from "./PdfShadings.js";
import { PdfSyntax } from "./PdfSyntax.js";

export interface ImageResource {
    key: string;
    object: number;
    width: number;
    height: number;
    links?: ReadonlyArray<readonly [PageRectangle, string, boolean]>;
}

export interface PageRectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class PdfPage {

    readonly object: number;
    readonly width: number;
    readonly height: number;
    readonly content: ContentStream = new ContentStream();
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly fonts: Map<string, number> = new Map<string, number>();
    private readonly images: Map<string, number> = new Map<string, number>();
    private readonly spaces: Map<string, string> = new Map<string, string>();
    private readonly shadings: Map<string, number> = new Map<string, number>();
    private readonly patterns: Map<string, number> = new Map<string, number>();
    private readonly states: Map<string, string> = new Map<string, string>();
    private readonly annotations: Array<number> = [];
    private readonly boxes: Map<string, PageRectangle> = new Map<string, PageRectangle>();
    private annotationArray?: number;

    constructor(object: number, width: number, height: number, turned: boolean = true) {
        // The page is given in points with its origin at the top left corner and y going down, as the layout has it;
        // ISO 32000-2 §8.3.2.3: default user space has its origin at the bottom left with y going up, so it is turned once.
        this.object = object;
        this.width = width;
        this.height = height;
        if (turned) {
            this.content.transform(1, 0, 0, -1, 0, height);
        }
    }

    useFont(font: FontResource): string {
        this.fonts.set(font.key, font.object);
        return font.key;
    }

    useImage(image: ImageResource): string {
        this.images.set(image.key, image.object);
        return image.key;
    }

    useColorSpace(space: ColorSpaceResource): string {
        // §8.6.8: a device space is named directly by cs; the other families are resources of the ColorSpace dictionary.
        if (space.value.startsWith("/")) {
            return space.key;
        }
        this.spaces.set(space.key, space.value);
        return space.key;
    }

    useShading(shading: ShadingResource): string {
        this.shadings.set(shading.key, shading.object);
        return shading.key;
    }

    usePattern(pattern: PatternResource): string {
        this.patterns.set(pattern.key, pattern.object);
        return pattern.key;
    }

    useState(fillAlpha: number, strokeAlpha: number, blend: string): string {
        // §8.4.5, Table 57: ca and CA are the constant alphas for filling and stroking, BM the blend mode of §11.3.5.
        return this.state("<< /Type /ExtGState /ca " + this.syntax.number(fillAlpha) + " /CA " + this.syntax.number(strokeAlpha) + " /BM " + this.syntax.name(blend) + " >>");
    }

    useShape(shape: number): string {
        // §11.6.4.3: with AIS true the constant alpha is a shape, which a knockout group mixes by (§11.4.6).
        return this.state("<< /Type /ExtGState /AIS true /ca " + this.syntax.number(shape) + " /CA " + this.syntax.number(shape) + " >>");
    }

    useMask(group: number, luminosity: boolean, inverted: boolean = false): string {
        // §11.6.5.2: a soft mask from the luminosity or the alpha of a transparency group, whose backdrop is black; an inverted
        // mask has the transfer function 1 - x (Table 142, TR).
        return this.state("<< /Type /ExtGState /SMask << /Type /Mask /S " + (luminosity ? "/Luminosity" : "/Alpha") + " /G " + this.syntax.reference(group)
            + (inverted ? " /TR << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>" : "") + " >> >>");
    }

    private state(entries: string): string {
        for (const [name, known] of this.states) {
            if (known === entries) {
                return name;
            }
        }
        const key: string = "GS" + this.states.size;
        this.states.set(key, entries);
        return key;
    }

    annotate(annotation: number): void {
        this.annotations.push(annotation);
    }

    get annotationObjects(): ReadonlyArray<number> {
        return this.annotations;
    }

    deferAnnotations(array: number): void {
        this.annotationArray = array;
    }

    setBox(name: "CropBox" | "BleedBox" | "TrimBox" | "ArtBox", rectangle: PageRectangle): void {
        // §14.11.2: the page boundaries, given like everything else on the page, from its top left corner.
        this.boxes.set(name, rectangle);
    }

    rectangle(area: PageRectangle): string {
        // §7.9.5: a rectangle is [llx lly urx ury] in default user space.
        return "[" + this.syntax.numbers([area.x, this.height - area.y - area.height, area.x + area.width, this.height - area.y]) + "]";
    }

    dictionary(parent: number, contents: number): string {
        // §7.7.3.3, Table 31: Type, Parent, Resources and MediaBox are required.
        let boxes: string = "";
        for (const [name, rectangle] of this.boxes) {
            boxes += " /" + name + " " + this.rectangle(rectangle);
        }
        let annotations: string = this.annotations.length === 0 ? "" : " /Annots [" + this.annotations.map((object: number) => this.syntax.reference(object)).join(" ") + "]";
        if (this.annotationArray !== undefined) {
            annotations = " /Annots " + this.syntax.reference(this.annotationArray);
        }
        return "<< /Type /Page /Parent " + this.syntax.reference(parent) + " /MediaBox [0 0 " + this.syntax.number(this.width) + " " + this.syntax.number(this.height) + "]"
            + boxes + " /Resources " + this.resources() + " /Contents " + this.syntax.reference(contents) + annotations + " >>";
    }

    resources(): string {
        // §7.8.3: the resources that the content stream names.
        let resources: string = "";
        resources += this.resourceGroup("Font", this.fonts);
        resources += this.resourceGroup("XObject", this.images);
        resources += this.resourceGroup("Shading", this.shadings);
        resources += this.resourceGroup("Pattern", this.patterns);
        if (this.spaces.size > 0) {
            resources += " /ColorSpace <<" + [...this.spaces].map((entry: [string, string]) => " " + this.syntax.name(entry[0]) + " " + entry[1]).join("") + " >>";
        }
        if (this.states.size > 0) {
            resources += " /ExtGState <<" + [...this.states].map((entry: [string, string]) => " " + this.syntax.name(entry[0]) + " " + entry[1]).join("") + " >>";
        }
        return "<<" + resources + " >>";
    }

    private resourceGroup(name: string, entries: ReadonlyMap<string, number>): string {
        if (entries.size === 0) {
            return "";
        }
        let group: string = " /" + name + " <<";
        for (const [key, object] of entries) {
            group += " " + this.syntax.name(key) + " " + this.syntax.reference(object);
        }
        return group + " >>";
    }
}
