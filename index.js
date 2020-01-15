#!/usr/bin/env node
const sh = require("shelljs");
const fs = require("fs");
const ts = require("typescript");
const path = require("path");
const assert = require("assert");

/** @typedef {import("typescript").Node} Node */

/** @param {import("typescript").TransformationContext} k */
function doTransform(k) {
  /**
   * @param {Node} n
   * @return {import("typescript").VisitResult<Node>}
   */
  const transform = function(n) {
    if (ts.isGetAccessor(n)) {
      // get x(): number => x: number
      let flags = ts.getCombinedModifierFlags(n);
      if (!getMatchingAccessor(n, "get")) {
        flags |= ts.ModifierFlags.Readonly;
      }
      const modifiers = ts.createModifiersFromModifierFlags(flags);
      return ts.createProperty(
        n.decorators,
        modifiers,
        n.name,
        /*?! token*/ undefined,
        defaultAny(n.type),
        /*initialiser*/ undefined
      );
    } else if (ts.isSetAccessor(n)) {
      // set x(value: number) => x: number
      let flags = ts.getCombinedModifierFlags(n);
      if (getMatchingAccessor(n, "set")) {
        return undefined;
      } else {
        assert(n.parameters && n.parameters.length);
        return ts.createProperty(
          n.decorators,
          n.modifiers,
          n.name,
          /*?! token*/ undefined,
          defaultAny(n.parameters[0].type),
          /*initialiser*/ undefined
        );
      }
    } else if (
      ts.isExportDeclaration(n) &&
      n.exportClause &&
      n.moduleSpecifier &&
      ts.isNamespaceExport(n.exportClause)
    ) {
      // export * as ns from 'x'
      //  =>
      // import * as ns_1 from 'x'
      // export { ns_1 as ns }
      const tempName = ts.createUniqueName(n.exportClause.name.getText());
      return [
        ts.createImportDeclaration(
          n.decorators,
          n.modifiers,
          ts.createImportClause(
            /*name*/ undefined,
            ts.createNamespaceImport(tempName)
          ),
          n.moduleSpecifier
        ),
        ts.createExportDeclaration(
          undefined,
          undefined,
          ts.createNamedExports([
            ts.createExportSpecifier(tempName, n.exportClause.name)
          ]),
          n.moduleSpecifier
        )
      ];
    }
    return ts.visitEachChild(n, transform, k);
  };
  return transform;
}

/** @param {import("typescript").TypeNode | undefined} t */
function defaultAny(t) {
  return t || ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
}

/**
 * @param {import("typescript").AccessorDeclaration} n
 * @param {'get' | 'set'} getset
 */
function getMatchingAccessor(n, getset) {
  if (!ts.isClassDeclaration(n.parent))
    throw new Error(
      "Bad AST -- accessor parent should be a class declaration."
    );
  const isOther = getset === "get" ? ts.isSetAccessor : ts.isGetAccessor;
  return n.parent.members.some(
    m => isOther(m) && m.name.getText() === n.name.getText()
  );
}
/**
 * @param {string} src
 * @param {string} target
 */
function main(src, target) {
  if (!src || !target) {
    console.log("Usage: node index.js test test/ts3.4");
    process.exit(1);
  }

  // TODO: target path is probably wrong for absolute src (or target?)
  // TODO: Probably will want to alter package.json if discovered in the right place.
  const program = ts.createProgram(
    sh
      .find(path.join(src))
      .filter(f => f.endsWith(".d.ts") && !/node_modules/.test(f)),
    {}
  );
  const checker = program.getTypeChecker(); // just used for setting parent pointers right now
  const files = mapDefined(program.getRootFileNames(), program.getSourceFile);
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.CarriageReturnLineFeed
  });
  for (const t of ts.transform(files, [doTransform]).transformed) {
    const f = /** @type {import("typescript").SourceFile} */ (t);
    const targetPath = path.join(target, f.fileName.slice(src.length));
    sh.mkdir("-p", path.dirname(targetPath));
    fs.writeFileSync(targetPath, printer.printFile(f));
  }
}
module.exports.main = main;

if (!(/** @type {*} */ (module.parent))) {
  const src = process.argv[2];
  const target = process.argv[3];
  main(src, target);
}

/**
 * @template T,U
 * @param {readonly T[]} l
 * @param {(t: T) => U | false | undefined} f
 * @return {U[]}
 */
function mapDefined(l, f) {
  const acc = [];
  for (const x of l) {
    const y = f(x);
    if (y) acc.push(y);
  }
  return acc;
}
