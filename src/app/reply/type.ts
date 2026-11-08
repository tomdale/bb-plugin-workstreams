/**
 * The reply's type scale: body 13/21, a part's title 13/19/600, a row's name
 * 13/20, secondary text 12/18, a label 11/17.6/500. Reply parts and prose share
 * these sizes, and the block sets the body size on its container, so a label
 * the renderer writes cannot come out larger than the prose it labels.
 */

export const BODY_CLASS = "text-[13px] leading-[21px]";
/** Secondary text: a scope, a stage's detail, a qualification. */
export const SECONDARY_CLASS = "text-[12px] leading-[18px]";
/** A part's title, and an option's name. */
export const TITLE_CLASS = "text-[13px] font-semibold leading-[19px]";
/** A row's name; 500 when the row reports a failure. */
export const ROW_NAME_CLASS = "text-[13px] leading-[20px]";
