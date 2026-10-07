import { expect, it } from "vitest";
import { UnresolvedSourceRetentionError, isUnresolvedSourceRetentionError, unresolvedSourceFailureTrace } from "../src/review/unresolved-source-diagnostic";
it("does not recognize generic or name-matching errors as retention diagnostics", () => {
 for (const error of [new Error("Review.UnresolvedSourceRetentionDenied"), {message:"Review.UnresolvedSourceRetentionDenied",trace:{predicate:"normalized-size-exceeded"}}, null]) {
  expect(unresolvedSourceFailureTrace(error)).toBeUndefined();
 }
});
it("whitelists fixed fields and rejects invalid enums and numeric metadata", () => {
 const good = new UnresolvedSourceRetentionError({phase:"prepare-first",role:"mapped",pairIndex:0},"normalized-size-exceeded",2000001);
 expect(unresolvedSourceFailureTrace(good)).toEqual({version:1,phase:"prepare-first",role:"mapped",pairIndex:0,predicate:"normalized-size-exceeded",normalizedCharacters:2000001,limitCharacters:2000000});
 for (const error of [
  new UnresolvedSourceRetentionError({phase:"SECRET" as any,role:"mapped",pairIndex:0},"serialized-child-present"),
  new UnresolvedSourceRetentionError({phase:"bind",role:"SECRET" as any,pairIndex:0},"serialized-child-present"),
  new UnresolvedSourceRetentionError({phase:"bind",role:"mapped",pairIndex:-1},"serialized-child-present"),
  new UnresolvedSourceRetentionError({phase:"bind",role:"mapped",pairIndex:NaN},"serialized-child-present"),
  new UnresolvedSourceRetentionError({phase:"bind",role:"mapped",pairIndex:0},"SECRET" as any),
  ...[NaN,Infinity,2000000,2000000.5].map(n=>new UnresolvedSourceRetentionError({phase:"bind",role:"mapped",pairIndex:0},"normalized-size-exceeded",n)),
 ]) expect(unresolvedSourceFailureTrace(error)).toBeUndefined();
});

it("ignores forged prototypes and reads no attacker-supplied trace getters", () => {
 const forged = Object.create(UnresolvedSourceRetentionError.prototype);
 Object.defineProperty(forged, "trace", {get:()=>{throw new Error("SECRET");}});
 expect(isUnresolvedSourceRetentionError(forged)).toBe(false);
 expect(unresolvedSourceFailureTrace(forged)).toBeUndefined();
 const known = new UnresolvedSourceRetentionError({phase:"bind",role:"source",pairIndex:0},"serialized-child-present");
 Object.defineProperty(known, "trace", {get:()=>{throw new Error("SECRET");}});
 expect(unresolvedSourceFailureTrace(known)).toMatchObject({phase:"bind",role:"source",predicate:"serialized-child-present"});
});
