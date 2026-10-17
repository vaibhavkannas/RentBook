/**
 * Reading source files as text, for the tests that check what the code does or does not contain (the route guard, the
 * client request rule, the brand name, the sheets). A comment or a string is found in the order they appear, so a
 * comment mark inside a string is not a comment, and a string mark inside a comment is not a string.
 */
export const COMMENT_OR_STRING =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;

const isComment = (token: string) => token.startsWith("//") || token.startsWith("/*");

/** The source with every comment blanked out; strings stay. */
export const withoutComments = (source: string) =>
  source.replace(COMMENT_OR_STRING, (token) => (isComment(token) ? " " : token));

/** The source with every comment blanked out and every string emptied to `""`. */
export const withoutCommentsAndStrings = (source: string) =>
  source.replace(COMMENT_OR_STRING, (token) => (isComment(token) ? " " : '""'));
