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

import type { ContainerQuery, Declaration, DeclaredValue, DescriptorRule, PropertyRule, StyleRule, Stylesheet } from "../css/Stylesheet.js";
import { StylesheetReader } from "../css/StylesheetReader.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { ElementSource, ImageAlpha, ImageDrawing, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "../images/ImageFormats.js";
import { BlockLayout } from "../layout/BlockLayout.js";
import type { Transform } from "../layout/BoxSizes.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { BoxFragment } from "../layout/Fragment.js";
import type { PaletteRule } from "../paint/ColorGlyphPainter.js";
import { ColorGlyphPainter } from "../paint/ColorGlyphPainter.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { XmlRootHandler } from "../parse/XmlRootHandler.js";
import { XmlTreeBuilder } from "../parse/XmlTreeBuilder.js";
import type { DocumentFonts, Input, PageSetup } from "../PdfGenerator.js";
import type { ElementBox, InlineSequence } from "../pdf/BoxTree.js";
import { Cascade } from "../pdf/Cascade.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { ElementUnits } from "../pdf/ElementUnits.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import type { Size } from "../pdf/PageCanvas.js";
import type { QueryContainer, StyleInput } from "../pdf/StyleComputer.js";
import { StyleComputer } from "../pdf/StyleComputer.js";
import { UserAgentRules } from "../pdf/UserAgentRules.js";
import { ValueSubstitution } from "../pdf/ValueSubstitution.js";
import { WhiteSpaceProcessor } from "../pdf/WhiteSpaceProcessor.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";
import { MathBoxes } from "./MathBoxes.js";
import { MathLayout } from "./MathLayout.js";
import { MathMarkup } from "./MathMarkup.js";
import type { Area } from "./MathPainter.js";
import { MathPainter } from "./MathPainter.js";

interface Formula {
    key: string;
    fragment: BoxFragment;
    layout: MathLayout;
    metrics: FontMetrics;
    palettes: ReadonlyArray<PaletteRule>;
    kept: boolean;
}

type Language = readonly [MathMarkup, Cascade, StyleComputer];

const MATH_INNER: string = "math";
const MATH_ROOT: string = "math";
const PHYSICAL: number = 0;

export class MathImage implements ImageFormat {

    static readonly NAMESPACE: string = MathMarkup.NAMESPACE;

    private readonly document: PdfDocument;
    private readonly images: ImageFormats;
    private readonly input: Input;
    private readonly setup: () => PageSetup;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly sizes: BoxSizes = new BoxSizes((): number | undefined => undefined);
    private own?: Language;
    private last?: Formula;
    private noSheet?: Stylesheet;
    private readonly painters: Map<FontMetrics, MathPainter> = new Map<FontMetrics, MathPainter>();

    constructor(document: PdfDocument, images: ImageFormats, input: Input, setup: () => PageSetup) {
        this.document = document;
        this.images = images;
        this.input = input;
        this.setup = setup;
    }

    static accepts(read: ImageReader, href: string): boolean {
        const root: XmlRootHandler = new XmlTreeBuilder().imageRoot(read, href);
        return root.localName() === MATH_ROOT && root.namespace() === MathMarkup.NAMESPACE;
    }

    private language(root: SourceElement, prefixes: ReadonlyMap<string, string>, uri: string, metrics: FontMetrics, sheet?: Stylesheet): Language {
        // Built at the first formula, so a document without one has none of the MathML rules, hints or values.
        const input: Input = this.input;
        const rules: ReadonlyArray<StyleRule> = sheet?.styleRules ?? input.styleRules;
        const substitution: ValueSubstitution = sheet === undefined ? input.substitution : new ValueSubstitution(input.table, sheet, prefixes, uri);
        const registered: ReadonlyMap<string, PropertyRule> = sheet === undefined ? input.registered
            : new Map<string, PropertyRule>(sheet.properties.map((rule: PropertyRule): [string, PropertyRule] => [rule.name, rule]));
        const markup: MathMarkup = new MathMarkup(input.table, prefixes, uri, metrics, root.getAttributeValue("xmlns"));
        const computer: StyleComputer = new StyleComputer(input.table, metrics, substitution, registered, input.profiles,
            (property: string, value: CssValue, style: StyleInput, standard: (name: string) => CssValue | undefined, units: ElementUnits, parentSize: () => number): CssValue | undefined =>
                markup.computedValue(property, value, style, standard, units, parentSize), MathMarkup.COMPUTED);
        const agent: UserAgentRules = new UserAgentRules(input.table);
        const agentRules: Array<StyleRule> = agent.styleRules();
        agentRules.push(...markup.styleRules(agent, agentRules.length));
        const cascade: Cascade = new Cascade(root, prefixes, uri, rules, agentRules, computer,
            (element: SourceElement): ReadonlyArray<Declaration> => markup.hints(element),
            (element: SourceElement): ReadonlyArray<Declaration> => markup.attachedDeclarations(element),
            (element: SourceElement): ReadonlyArray<string> | undefined => markup.classes(element));
        return [markup, cascade, computer];
    }

    private documentLanguage(): Language {
        if (this.own === undefined) {
            this.own = this.language(this.input.root, this.input.prefixes, this.input.documentUri, this.input.metrics);
        }
        return this.own;
    }

    private linkedSheet(tree: XmlTreeBuilder, href: string): Stylesheet {
        // A file with no style sheet of its own takes an empty one, so that nothing of the document's reaches it.
        const instructions: ReadonlyArray<string> = tree.getStyleInstructions();
        if (instructions.length > 0) {
            return new StylesheetReader(this.input.table).readLinked(instructions, href);
        }
        this.noSheet = this.noSheet ?? new StylesheetReader(this.input.table).readLinked(instructions, href);
        return this.noSheet;
    }

    replaces(source: ElementSource): boolean {
        // MathML Core §4.1: MathML elements with display math "control box generation and layout according to their tag
        // name", inside math or not; the first one met outside a formula is drawn as one image with its subtree.
        return this.displays.parse(source.style.values["display"]).inner === MATH_INNER;
    }

    style(element: SourceElement, parent: ComputedStyle | undefined, root: ComputedStyle | undefined, viewport: Size, containers: () => Iterable<QueryContainer>): ComputedStyle {
        const [, cascade, computer]: Language = this.documentLanguage();
        const cascaded: Map<string, DeclaredValue> = cascade.element(element, (queries: ReadonlyArray<ContainerQuery>) =>
            computer.containersHold(queries, containers, viewport));
        return computer.compute(StyleComputer.input(cascaded, viewport, containers, parent, root, element));
    }

    viewportUsed(): boolean {
        return this.own?.[2].viewportUsed === true;
    }

    unclipped(): boolean {
        // MathML Core §3.2.1.1 sizes a token by its ink, and mpadded or a positioned child can put ink outside the formula,
        // which only the overflow property of its box clips.
        return true;
    }

    private keep(messages: ReadonlyArray<string>): void {
        for (const message of messages) {
            if (!this.images.diagnostics.includes(message)) {
                this.images.diagnostics.push(message);
            }
        }
    }

    size(read: ImageReader, href: string, available?: number): ImageSize | undefined {
        // The image is the content of the formula laid out in the inline size available, with its baseline.
        const formula: Formula | undefined = this.formula(href, available, read);
        if (formula === undefined) {
            return undefined;
        }
        const fragment: BoxFragment = formula.fragment;
        const size: ImageSize = { width: fragment.inlineSize, height: fragment.blockSize, turned: false, raster: false };
        if (this.images.source(href) === undefined && fragment.inlineSize > 0 && fragment.blockSize > 0) {
            size.ratio = fragment.inlineSize / fragment.blockSize;
        }
        if (fragment.firstBaseline !== undefined) {
            size.baseline = fragment.firstBaseline;
        }
        return size;
    }

    key(drawing: ImageDrawing): string {
        return drawing.width + "x" + drawing.height;
    }

    draw(request: ImageRequest): ImageResource | undefined {
        // MathML Core §3.1.2: a size given to the content box "is used instead", the math content box aligned with it, so an element
        // is laid out in the width of its box and never scaled.
        const inFile: boolean = this.images.source(request.href) === undefined;
        const formula: Formula | undefined = this.formula(request.href, inFile ? undefined : request.width, (position: number, length: number) => request.data.subarray(position, position + length));
        if (formula === undefined) {
            return undefined;
        }
        const fragment: BoxFragment = formula.fragment;
        const setup: PageSetup = this.setup();
        let painter: MathPainter | undefined = this.painters.get(formula.metrics);
        if (painter === undefined) {
            painter = new MathPainter(this.document, setup.colors, formula.metrics, setup.viewport, this.images, formula.palettes);
            if (formula.kept) {
                this.painters.set(formula.metrics, painter);
            }
        }
        const frame: number = this.sizes.frame(fragment.box.style);
        const transform: Transform = this.sizes.between(frame, PHYSICAL, fragment.inlineSize, fragment.blockSize);
        // The form's box is what is painted and not the size of the formula, and it is in the form's own space, where y goes up.
        const painted: Area | undefined = painter.extent(fragment, formula.layout.graphics, transform);
        // A file is drawn at its natural size, and the form's matrix scales everything in it, glyphs included.
        const width: number = inFile ? fragment.inlineSize : request.width;
        const height: number = inFile ? fragment.blockSize : request.height;
        if (painted === undefined && (width <= 0 || height <= 0)) {
            return undefined;
        }
        const ink: Area = painted ?? [0, 0, width, height];
        const form: PdfPage = this.document.startForm(width, height, true);
        const links: ReadonlyArray<readonly [PageRectangle, string, boolean]> = painter.paint(fragment, formula.layout.graphics, transform, form);
        // A renderer rounds the edges of a clip to its pixels, which can lose a row of ink lying on an edge, so the box ends past it.
        const left: number = Math.floor(Math.min(0, ink[0])) - MathPainter.EDGE;
        const top: number = Math.floor(Math.min(0, ink[1])) - MathPainter.EDGE;
        const right: number = Math.ceil(Math.max(width, ink[0] + ink[2])) + MathPainter.EDGE;
        const bottom: number = Math.ceil(Math.max(height, ink[1] + ink[3])) + MathPainter.EDGE;
        const across: number = width > 0 ? width : 1;
        const down: number = height > 0 ? height : 1;
        const resource: ImageResource = this.document.finishForm(form, [left, height - bottom, right - left, bottom - top], [1 / across, 0, 0, 1 / down, 0, 0]);
        resource.width = width;
        resource.height = height;
        if (links.length > 0) {
            // The link areas of the image are in its unit square, with v going down as on the form and t = (height - y) / down.
            resource.links = links.map(([area, name, internal]: readonly [PageRectangle, string, boolean]): readonly [PageRectangle, string, boolean] =>
                [{ x: area.x / across, y: 1 - (height - area.y) / down, width: area.width / across, height: area.height / down }, name, internal]);
        }
        return resource;
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "the rendering of a formula into samples");
    }

    alpha(href: string): ImageAlpha | undefined {
        throw this.images.missing(href, "the rendering of a formula into an alpha channel");
    }

    private formula(href: string, available: number | undefined, read: ImageReader): Formula | undefined {
        // The boxes of the formula take their styles from its cascade, their text is prepared as all text is, and math layout
        // places them; only the last layout is kept, the one that its drawing usually follows.
        const key: string = href + "@" + (available ?? "");
        if (this.last?.key === key) {
            return this.last;
        }
        const setup: PageSetup = this.setup();
        const source: ElementSource | undefined = this.images.source(href);
        let language: Language;
        let element: SourceElement;
        let style: ComputedStyle;
        let root: ComputedStyle;
        let fonts: DocumentFonts = this.input.fonts;
        let palettes: ReadonlyArray<PaletteRule> = setup.palettes;
        // Fonts of a file's own rules serve only that file, so a document with many such files does not keep them all.
        let kept: boolean = true;
        if (source === undefined) {
            // A file is a document of its own: the document's style sheet and its @font-face rules (CSS Fonts 4 §4) do not reach
            // into it, and it has the MathML rules, its own markup and the style sheets its prolog links.
            const tree: XmlTreeBuilder = new XmlTreeBuilder();
            try {
                element = tree.buildFromImage(read, href);
            } catch (error) {
                this.images.report(href, "cannot be parsed: " + (error instanceof Error ? error.message : String(error)));
                return undefined;
            }
            const sheet: Stylesheet = this.linkedSheet(tree, href);
            this.keep(sheet.diagnostics);
            fonts = this.input.fontsFor(sheet.fontFaces, sheet.fontFeatureValues);
            kept = sheet.fontFaces.length === 0 && sheet.fontFeatureValues.length === 0 && sheet.fontPalettes.length === 0;
            language = this.language(element, tree.getPrefixes(), href, fonts[0], sheet);
            style = language[2].compute(StyleComputer.input(language[1].element(element, () => false), setup.viewport, StyleComputer.NO_CONTAINERS, undefined, undefined, element));
            root = style;
            palettes = sheet.fontPalettes.map((rule: DescriptorRule) => ColorGlyphPainter.fromRule(rule, language[2], root, setup.viewport));
        } else {
            language = this.documentLanguage();
            element = source.element;
            style = source.style;
            root = setup.root;
        }
        const [metrics, text]: DocumentFonts = fonts;
        const [markup, cascade, computer]: Language = language;
        const boxes: MathBoxes = new MathBoxes(markup, cascade, computer, setup.references);
        const box: ElementBox | undefined = boxes.build(element, style, setup.viewport, root);
        if (box === undefined) {
            return undefined;
        }
        const sequences: Array<InlineSequence> = new WhiteSpaceProcessor().process(box);
        text.prepare(sequences);
        const host: BlockLayout = new BlockLayout(metrics, text, this.images);
        const layout: MathLayout = new MathLayout(host, new BoxSizes((): number | undefined => undefined), metrics, boxes.elements);
        const fragment: BoxFragment = layout.formula(box, {}, available);
        this.last = { key, fragment, layout, metrics, palettes, kept };
        return this.last;
    }
}
