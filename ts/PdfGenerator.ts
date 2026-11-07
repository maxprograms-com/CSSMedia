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

import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { PropertyTable } from "./css/PropertyTable.js";
import type { DeclaredValue, Declaration, FontFaceRule, MarginRule, PageRule, PropertyRule, StyleRule, Stylesheet, TocRule } from "./css/Stylesheet.js";
import { StylesheetReader } from "./css/StylesheetReader.js";
import type { CssValue, FunctionValue } from "./css/values/CssValue.js";
import { FontCatalog } from "./fonts/FontCatalog.js";
import { BmpImage } from "./images/BmpImage.js";
import { GifImage } from "./images/GifImage.js";
import { HeifImage } from "./images/HeifImage.js";
import type { ImageFormat } from "./images/ImageFormats.js";
import { ImageFormats } from "./images/ImageFormats.js";
import { Jp2Image } from "./images/Jp2Image.js";
import { JpegImage } from "./images/JpegImage.js";
import { PngImage } from "./images/PngImage.js";
import { TiffImage } from "./images/TiffImage.js";
import { WebpImage } from "./images/WebpImage.js";
import { BlockLayout } from "./layout/BlockLayout.js";
import { PageDriver } from "./pages/PageDriver.js";
import { ColorOutput } from "./paint/ColorOutput.js";
import { SourceElement } from "./parse/SourceElement.js";
import { XmlTreeBuilder } from "./parse/XmlTreeBuilder.js";
import { BoxBuilder } from "./pdf/BoxBuilder.js";
import type { ElementBox, InlineSequence, TextSequence } from "./pdf/BoxTree.js";
import { Cascade } from "./pdf/Cascade.js";
import { ColorProfiles } from "./pdf/ColorProfiles.js";
import type { ComputedStyle } from "./pdf/ComputedStyle.js";
import { CounterStyles } from "./pdf/CounterStyles.js";
import { CrossReferences } from "./pdf/CrossReferences.js";
import { FirstLetterBoxes } from "./pdf/FirstLetterBoxes.js";
import { FontFeatures } from "./pdf/FontFeatures.js";
import { FontMatcher } from "./pdf/FontMatcher.js";
import { FontMetrics } from "./pdf/FontMetrics.js";
import { InlineTextBuilder } from "./pdf/InlineTextBuilder.js";
import { MathImage } from "./mathml/MathImage.js";
import type { PageContext, Rectangle, Size } from "./pdf/PageCanvas.js";
import { PageCanvasBuilder } from "./pdf/PageCanvasBuilder.js";
import { QuoteSystems } from "./pdf/QuoteSystems.js";
import { StyleComputer } from "./pdf/StyleComputer.js";
import { UserAgentRules } from "./pdf/UserAgentRules.js";
import { ValueSubstitution } from "./pdf/ValueSubstitution.js";
import { WhiteSpaceProcessor } from "./pdf/WhiteSpaceProcessor.js";
import { SvgImage } from "./svg/SvgImage.js";
import { PdfDocument } from "./writer/PdfDocument.js";

export interface PageSetup {
    root: ComputedStyle;
    builder: BoxBuilder;
    boxes: ElementBox;
    canvases: PageCanvasBuilder;
    viewport: Size;
    recto: "left" | "right";
    firstSide: "left" | "right";
    layout: BlockLayout;
    profiles: ColorProfiles;
    colors: ColorOutput;
    images: ImageFormats;
    metrics: FontMetrics;
    text: InlineTextBuilder;
    counterStyles: CounterStyles;
    marginsLater: boolean;
    references: CrossReferences;
    whiteSpace: WhiteSpaceProcessor;
    letters: FirstLetterBoxes;
    reports: Array<ReadonlyArray<string>>;
}

export type DocumentFonts = readonly [FontMetrics, InlineTextBuilder];

export interface Input {
    root: SourceElement;
    documentUri: string;
    cssPath: string;
    prefixes: ReadonlyMap<string, string>;
    table: PropertyTable;
    substitution: ValueSubstitution;
    registered: ReadonlyMap<string, PropertyRule>;
    styleRules: ReadonlyArray<StyleRule>;
    computer: StyleComputer;
    cascade: Cascade;
    canvases: PageCanvasBuilder;
    assumed: Size;
    counterStyles: CounterStyles;
    text: InlineTextBuilder;
    metrics: FontMetrics;
    fonts: DocumentFonts;
    fontFaces: ReadonlyArray<FontFaceRule>;
    fontsFor: (rules: ReadonlyArray<FontFaceRule>) => DocumentFonts;
    profiles: ColorProfiles;
    marginBoxes: boolean;
    countsPages: boolean;
    marginTargets: boolean;
    targetCounters: boolean;
    linkCounters: boolean;
    tocRules: ReadonlyArray<TocRule>;
    reports: Array<ReadonlyArray<string>>;
}

const PAGES: string = "pages";
const PAGE: string = "page";
const TARGET: string = "target-";
const TARGET_COUNTERS: RegExp = /target-counters?\(/i;
const LINK_COUNTERS: RegExp = new RegExp(PropertyTable.LINK_COUNTER + "\\(\\s*(?!page\\s*[,)])", "i");
const TARGET_FUNCTIONS: RegExp = /target-(?:counters?|text)\(/i;
const COUNTS_PAGES: RegExp = /counters?\(\s*pages\s*[,)]/i;
const VARIABLE: RegExp = /var\(/i;

export class PdfGenerator {

    readonly warnings: Array<string> = [];
    private readonly fontFolder?: string;
    private readonly catalog?: string;

    constructor(fontFolder?: string, catalog?: string) {
        if (fontFolder !== undefined) {
            this.fontFolder = fontFolder;
        }
        if (catalog !== undefined) {
            this.catalog = catalog;
        }
    }

    generate(xmlPath: string, cssPath: string, pdfPath: string): void {
        // One generator can make several documents, and the warnings it shows are those of the last one.
        this.warnings.length = 0;
        const input: Input = this.read(xmlPath, cssPath);
        const document: PdfDocument = new PdfDocument(pdfPath);
        const colors: ColorOutput = new ColorOutput(document, input.profiles);
        const images: ImageFormats = new ImageFormats(document);
        images.register(PngImage.accepts, (): ImageFormat => new PngImage(images));
        images.register(JpegImage.accepts, (): ImageFormat => new JpegImage(images));
        images.register(Jp2Image.accepts, (): ImageFormat => new Jp2Image(images));
        images.register(HeifImage.accepts, (): ImageFormat => new HeifImage(images));
        images.register(GifImage.accepts, (): ImageFormat => new GifImage(images));
        images.register(BmpImage.accepts, (): ImageFormat => new BmpImage(images));
        images.register(TiffImage.accepts, (): ImageFormat => new TiffImage(images));
        images.register(WebpImage.accepts, (): ImageFormat => new WebpImage(images));
        const references: CrossReferences = new CrossReferences(input.documentUri, input.marginTargets, input.cascade);
        let setup: PageSetup | undefined;
        images.register(SvgImage.accepts, (): ImageFormat => new SvgImage(document, images, colors, input, (): PageSetup => setup as PageSetup), SvgImage.NAMESPACES);
        images.register(MathImage.accepts, (): ImageFormat => new MathImage(document, images, input, (): PageSetup => setup as PageSetup), [MathImage.NAMESPACE]);
        images.setNamespaces(input.prefixes, input.root.getAttributeValue("xmlns"));
        try {
            setup = this.pageSetup(input, references, images, colors);
            this.settleTexts(setup);
            // CSS Content 3 §2.6: the page of a target is known only from a layout, so the layout that shows it comes after.
            if (references.showsPages) {
                new PageDriver(setup, document).run(false, false);
                this.settleTexts(setup);
            }
            if (!new PageDriver(setup, document).run(true, references.showsPages)) {
                document.restart();
                colors.restart();
                images.restart();
                this.settleTexts(setup);
                new PageDriver(setup, document).run(true, false);
                references.reportMoved();
            }
            references.reportLinks((id: string) => document.hasDestination(id));
            this.outline(setup, document);
            document.finish();
        } catch (error) {
            document.abort();
            throw error;
        } finally {
            // The classes keep adding the minor problems they find while the run goes on, so they are read when it ends.
            const reports: Array<ReadonlyArray<string>> = [...input.reports, references.diagnostics, images.diagnostics];
            if (setup !== undefined) {
                reports.push(...setup.reports, setup.layout.diagnostics);
            }
            for (const report of reports) {
                this.warnings.push(...report);
            }
        }
    }

    private outline(setup: PageSetup, document: PdfDocument): void {
        // CSS Content 3 §3: a bookmark goes to its element "as if navigating to that element by fragment URL", so an element
        // with no box laid out has nowhere to go and makes no bookmark.
        for (const [target, level, open, label] of setup.builder.bookmarkEntries()) {
            const name: string | undefined = setup.references.bookmarkName(target);
            if (name !== undefined && document.hasDestination(name)) {
                document.addOutline(label, level, name, open);
            }
        }
    }

    private read(xmlPath: string, cssPath: string): Input {
        const treeBuilder: XmlTreeBuilder = new XmlTreeBuilder();
        const root: SourceElement = treeBuilder.buildFromFile(xmlPath, this.catalog);
        const documentUri: string = pathToFileURL(resolvePath(xmlPath)).href;
        const stylesheet: Stylesheet = new StylesheetReader().read(cssPath);
        const fonts: FontCatalog = new FontCatalog(stylesheet.fontFaces, this.fontFolder);
        const table: PropertyTable = new PropertyTable();
        const substitution: ValueSubstitution = new ValueSubstitution(table, stylesheet, treeBuilder.getPrefixes(), documentUri);
        // CSS Properties and Values 1 §3: the last valid @property rule for a name is the registration.
        const registered: Map<string, PropertyRule> = new Map<string, PropertyRule>(stylesheet.properties.map((rule: PropertyRule): [string, PropertyRule] => [rule.name, rule]));
        const matcher: FontMatcher = new FontMatcher(fonts);
        const metrics: FontMetrics = new FontMetrics(matcher);
        const profiles: ColorProfiles = new ColorProfiles(stylesheet.colorProfiles);
        const computer: StyleComputer = new StyleComputer(table, metrics, substitution, registered, profiles);
        const cascade: Cascade = new Cascade(root, treeBuilder.getPrefixes(), documentUri, stylesheet.styleRules, new UserAgentRules(table).styleRules(), computer);
        const canvases: PageCanvasBuilder = new PageCanvasBuilder(cascade, computer, stylesheet.pageRules, table);
        const text: InlineTextBuilder = new InlineTextBuilder(metrics, matcher, new FontFeatures(stylesheet.fontFeatureValues));
        let plain: DocumentFonts | undefined;
        const fontsFor: (rules: ReadonlyArray<FontFaceRule>) => DocumentFonts = (rules: ReadonlyArray<FontFaceRule>): DocumentFonts => {
            // Files without @font-face rules have the same fonts, so they share one set.
            if (rules.length === 0) {
                plain = plain ?? this.fontsOf(fonts.ofDocument(rules));
                return plain;
            }
            return this.fontsOf(fonts.ofDocument(rules));
        };
        return {
            root, documentUri, cssPath, prefixes: treeBuilder.getPrefixes(), table, substitution, registered, styleRules: stylesheet.styleRules, computer, cascade, canvases,
            // CSS Paged Media 3 §3: "The edges of the page area on the first page establish the rectangle that is the initial
            // containing block of the document", and CSS Values 4 §6.1.2 sizes the viewport units with that rectangle.
            assumed: canvases.defaultPageArea(computer.initial()),
            counterStyles: new CounterStyles(stylesheet.counterStyles),
            text,
            metrics,
            fonts: [metrics, text],
            fontFaces: stylesheet.fontFaces,
            fontsFor,
            profiles,
            marginBoxes: stylesheet.pageRules.some((rule: PageRule) => rule.marginRules.length > 0),
            countsPages: this.marginContent(stylesheet, (value: FunctionValue): boolean => (value.name === "counter" || value.name === "counters") && this.firstName(value) === PAGES,
                COUNTS_PAGES),
            marginTargets: this.marginContent(stylesheet, (value: FunctionValue): boolean => value.name.startsWith(TARGET), TARGET_FUNCTIONS),
            targetCounters: this.usesFunction(stylesheet, TARGET_COUNTERS, (found: FunctionValue): boolean => found.name === "target-counter" || found.name === "target-counters"),
            linkCounters: this.usesFunction(stylesheet, LINK_COUNTERS, (found: FunctionValue): boolean => found.name === PropertyTable.LINK_COUNTER && this.firstName(found) !== PAGE),
            tocRules: stylesheet.tocRules,
            reports: [stylesheet.diagnostics, fonts.diagnostics, profiles.diagnostics, computer.diagnostics]
        };
    }

    private fontsOf(catalog: FontCatalog): DocumentFonts {
        const matcher: FontMatcher = new FontMatcher(catalog);
        const metrics: FontMetrics = new FontMetrics(matcher);
        return [metrics, new InlineTextBuilder(metrics, matcher, new FontFeatures([]))];
    }

    private usesFunction(stylesheet: Stylesheet, pattern: RegExp, test: (value: FunctionValue) => boolean): boolean {
        // A custom property can carry the function into content, so the text of every declaration is looked at.
        const declared: (declarations: ReadonlyArray<Declaration>) => boolean = (declarations: ReadonlyArray<Declaration>): boolean =>
            declarations.some((declaration: Declaration) => this.declares(declaration.value, pattern, test));
        return stylesheet.styleRules.some((rule: StyleRule) => declared(rule.declarations))
            || stylesheet.pageRules.some((rule: PageRule) => declared(rule.declarations) || declared(rule.footnote)
                || rule.marginRules.some((margin: MarginRule) => declared(margin.declarations)));
    }

    private declares(value: DeclaredValue, pattern: RegExp, test: (value: FunctionValue) => boolean): boolean {
        if (value.kind === "pending" || value.kind === "custom") {
            return pattern.test(value.text);
        }
        if (value.kind === "toggle") {
            return value.values.some((item: DeclaredValue) => this.declares(item, pattern, test));
        }
        return value.kind === "value" && this.hasFunction(value.value, test);
    }

    private settleTexts(setup: PageSetup): void {
        // A target-text() of an element that holds another cross-reference, a page number included, changes when that one is
        // filled, so the texts are filled until they stop changing; a chain is no longer than the number of targets.
        const references: CrossReferences = setup.references;
        let rounds: number = setup.builder.targets.size + 1;
        this.refill(setup);
        while (references.collect(setup.boxes)) {
            this.refill(setup);
            rounds--;
            if (rounds === 0) {
                const message: string = "The texts of the cross-references refer to each other in a cycle, so some of them do not settle";
                if (!references.diagnostics.includes(message)) {
                    references.diagnostics.push(message);
                }
                return;
            }
        }
    }

    private refill(setup: PageSetup): void {
        const changed: Map<InlineSequence, Array<readonly [TextSequence, string]>> = new Map<InlineSequence, Array<readonly [TextSequence, string]>>();
        const targets: Map<TextSequence, string> = setup.builder.targets;
        for (const [node, shown] of targets) {
            const value: string = setup.builder.targetText(node);
            const sequence: InlineSequence | undefined = setup.whiteSpace.sequenceOf(node);
            if (sequence === undefined || value === shown) {
                continue;
            }
            targets.set(node, value);
            const nodes: Array<readonly [TextSequence, string]> | undefined = changed.get(sequence);
            if (nodes === undefined) {
                changed.set(sequence, [[node, value]]);
            } else {
                nodes.push([node, value]);
            }
        }
        for (const [sequence, nodes] of changed) {
            setup.letters.undo(sequence);
            for (const [node, value] of nodes) {
                node.text = value;
            }
            setup.whiteSpace.again(sequence);
            setup.text.prepare([sequence, ...setup.letters.again(sequence)]);
        }
        if (changed.size > 0) {
            setup.builder.resetStrings();
        }
    }

    private containerContents(builder: BoxBuilder, whiteSpace: WhiteSpaceProcessor, letters: FirstLetterBoxes, text: InlineTextBuilder, box: ElementBox,
        inlineSize: number, blockSize?: number): boolean {
        // CSS Conditional 5 §5.1: the contents of a size query container are built when layout knows its size, and then go
        // through the same white space processing, first letters and text preparation as the rest of the box tree.
        if (!builder.containerContents(box, inlineSize, blockSize)) {
            return false;
        }
        const sequences: Array<InlineSequence> = whiteSpace.process(box);
        letters.apply(box, sequences);
        text.prepare(sequences);
        return true;
    }

    private pageSetup(input: Input, references: CrossReferences, images: ImageFormats, colors: ColorOutput): PageSetup {
        const assumed: Size = input.assumed;
        const text: InlineTextBuilder = input.text;
        const whiteSpace: WhiteSpaceProcessor = new WhiteSpaceProcessor();
        let quoteSystems: QuoteSystems = new QuoteSystems();
        let boxBuilder: BoxBuilder = new BoxBuilder(input.cascade, input.computer, images, assumed, input.counterStyles, quoteSystems,
            input.marginBoxes || input.linkCounters, input.targetCounters, references, input.tocRules);
        let letters: FirstLetterBoxes | undefined;
        const layout: BlockLayout = new BlockLayout(input.metrics, text, images, (box: ElementBox, inlineSize: number, blockSize?: number): boolean =>
            this.containerContents(boxBuilder, whiteSpace, letters as FirstLetterBoxes, text, box, inlineSize, blockSize));
        let boxes: ElementBox | undefined = boxBuilder.build(input.root);
        if (boxes === undefined) {
            throw new Error("The root element generates no box (display: none)");
        }
        // The first page depends on the root's style, so styles are computed with the page area media queries assume (CSS Paged
        // Media 3 §7.1), and again only if they used a viewport unit and the first page has another area.
        const usedViewport: boolean = input.computer.viewportUsed || images.viewportUsed();
        const assumedRoot: ComputedStyle = boxBuilder.rootStyle ?? boxes.style;
        const assumedSide: "left" | "right" = layout.firstSide(boxes, input.canvases.firstPageSide(assumedRoot));
        const firstArea: Rectangle = input.canvases.build(this.pageContext(boxes.startPage, assumedSide), assumedRoot, assumed).pageArea;
        const viewport: Size = { width: firstArea.width, height: firstArea.height };
        if (usedViewport && (viewport.width !== assumed.width || viewport.height !== assumed.height)) {
            quoteSystems = new QuoteSystems();
            boxBuilder = new BoxBuilder(input.cascade, input.computer, images, viewport, input.counterStyles, quoteSystems, input.marginBoxes || input.linkCounters,
                input.targetCounters, references, input.tocRules);
            boxes = boxBuilder.build(input.root) ?? boxes;
        }
        letters = new FirstLetterBoxes(boxBuilder, whiteSpace);
        const sequences: Array<InlineSequence> = whiteSpace.process(boxes);
        letters.apply(boxes, sequences);
        text.prepare(sequences);
        // CSS Tables 3 §2.2.1: when the root element is a table, the box at the top is its anonymous table wrapper box.
        const rootStyle: ComputedStyle = boxBuilder.rootStyle ?? boxes.style;
        const recto: "left" | "right" = input.canvases.firstPageSide(rootStyle);
        return {
            root: rootStyle,
            builder: boxBuilder,
            boxes,
            canvases: input.canvases,
            viewport,
            recto,
            firstSide: layout.firstSide(boxes, recto),
            layout,
            profiles: input.profiles,
            colors,
            images,
            metrics: input.metrics,
            text,
            counterStyles: input.counterStyles,
            marginsLater: input.countsPages || input.marginTargets,
            references,
            whiteSpace,
            letters,
            reports: [boxBuilder.diagnostics, quoteSystems.diagnostics]
        };
    }

    private marginContent(stylesheet: Stylesheet, test: (value: FunctionValue) => boolean, pattern: RegExp): boolean {
        // CSS Paged Media 3 §6.1: the pages counter "is always the total number of pages in the document", and a
        // cross-reference shows what the layout of its target gives, so both wait for the end of the layout.
        return stylesheet.pageRules.some((rule: PageRule) => rule.marginRules.some((margin: MarginRule) => margin.declarations.some((declaration: Declaration) =>
            declaration.property === "content" && this.marginValue(declaration.value, stylesheet, test, pattern))));
    }

    private marginValue(value: DeclaredValue, stylesheet: Stylesheet, test: (value: FunctionValue) => boolean, pattern: RegExp): boolean {
        if (value.kind === "value") {
            return this.hasFunction(value.value, test);
        }
        if (value.kind === "toggle") {
            return value.values.some((item: DeclaredValue) => this.marginValue(item, stylesheet, test, pattern));
        }
        // A var() can bring the function from any custom property that the margin box inherits.
        return value.kind === "pending" && (pattern.test(value.text) || (VARIABLE.test(value.text) && this.customHolds(stylesheet, pattern)));
    }

    private customHolds(stylesheet: Stylesheet, pattern: RegExp): boolean {
        const holds: (declarations: ReadonlyArray<Declaration>) => boolean = (declarations: ReadonlyArray<Declaration>): boolean =>
            declarations.some((declaration: Declaration) => declaration.value.kind === "custom" && pattern.test(declaration.value.text));
        return stylesheet.styleRules.some((rule: StyleRule) => holds(rule.declarations))
            || stylesheet.pageRules.some((rule: PageRule) => holds(rule.declarations) || rule.marginRules.some((margin: MarginRule) => holds(margin.declarations)));
    }

    private hasFunction(value: CssValue, test: (value: FunctionValue) => boolean): boolean {
        if (value.kind === "function") {
            return test(value) || value.args.some((argument: CssValue) => this.hasFunction(argument, test));
        }
        return value.kind === "list" && value.items.some((item: CssValue) => this.hasFunction(item, test));
    }

    private firstName(value: FunctionValue): string | undefined {
        const first: CssValue | undefined = value.args[0];
        return first !== undefined && first.kind === "ident" ? first.name : undefined;
    }

    private pageContext(name: string, side: "left" | "right"): PageContext {
        // CSS Paged Media 3 §8.1: the first page's type is the start page value of the root, and the empty name names no page.
        return name.length === 0 ? { first: true, side, blank: false, position: 1, groups: [] } : { name, first: true, side, blank: false, position: 1, groups: [] };
    }

}
