import {Keypoint} from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/Keypoint"
import TrackedHand from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"

/**
 * Cosine of the largest bend, joint to joint, that still counts as a straight index finger. A
 * pointing finger stays close to straight at both its middle and top joints; a curled one - in a
 * fist or a pinch - bends well past this at one of them. Generous, because tracking of the
 * fingertip joints wobbles by tens of degrees from frame to frame.
 */
const STRAIGHT_JOINT_COS = Math.cos((50 * Math.PI) / 180)

/**
 * Whether the index finger is held out straight, as in pointing or poking.
 *
 * Measured from the finger's own joints - knuckle, middle joint, top joint and tip - rather than
 * SIK's PalmState, which reads the middle finger and so calls a pointing hand closed: the other
 * three fingers curl out of the way when you point.
 */
export function isIndexExtended(hand: TrackedHand): boolean {
  const knuckle = hand.indexKnuckle?.position
  const middle = hand.indexMidJoint?.position
  const upper = hand.indexUpperJoint?.position
  const tip = hand.indexTip?.position

  if (knuckle == null || middle == null || upper == null || tip == null) {
    return false
  }

  const first = middle.sub(knuckle)
  const second = upper.sub(middle)
  const third = tip.sub(upper)

  if (first.length < 0.0001 || second.length < 0.0001 || third.length < 0.0001) {
    return false
  }

  return (
    first.normalize().dot(second.normalize()) >= STRAIGHT_JOINT_COS &&
    second.normalize().dot(third.normalize()) >= STRAIGHT_JOINT_COS
  )
}

/**
 * How much further than its own knuckle a fingertip may be from the wrist and still count as folded.
 * A finger curled into the palm brings its tip back to about its knuckle's distance, or closer; one
 * held out straight puts its tip nearly twice as far.
 */
const CURLED_REACH = 1.4

/**
 * How much further from the wrist the index tip has to be than the furthest of the other three
 * fingertips for the hand to be pointing. In a fist every tip is tucked in at much the same
 * distance, however straight the index joints happen to read.
 */
const POINT_LEAD = 1.35

/** Whether a finger is folded in towards the palm, judged by how far its tip has come back. */
function isCurled(wrist: vec3, knuckle: Keypoint, tip: Keypoint): boolean {
  const knucklePosition = knuckle?.position
  const tipPosition = tip?.position
  if (knucklePosition == null || tipPosition == null) {
    return false
  }
  return tipPosition.distance(wrist) < knucklePosition.distance(wrist) * CURLED_REACH
}

/**
 * Whether the hand is pointing: the index held out straight and the middle, ring and little fingers
 * all folded away, so only the index sticks out.
 *
 * This is what tells a poke apart from the whole hand at the sphere. An open hand has every finger
 * out, and a fist - which crushes the sphere - has every finger in, even when tracking reads its
 * index joints as straight, because the index tip is still tucked in beside the others.
 */
export function isPointingPose(hand: TrackedHand): boolean {
  if (!isIndexExtended(hand)) {
    return false
  }

  const wrist = hand.wrist?.position
  const indexTip = hand.indexTip?.position
  if (wrist == null || indexTip == null) {
    return false
  }

  if (
    !isCurled(wrist, hand.middleKnuckle, hand.middleTip) ||
    !isCurled(wrist, hand.ringKnuckle, hand.ringTip) ||
    !isCurled(wrist, hand.pinkyKnuckle, hand.pinkyTip)
  ) {
    return false
  }

  let furthestOther = 0
  const others = [hand.middleTip, hand.ringTip, hand.pinkyTip]
  for (let i = 0; i < others.length; i++) {
    const position = others[i]?.position
    if (position != null) {
      furthestOther = Math.max(furthestOther, position.distance(wrist))
    }
  }

  return indexTip.distance(wrist) >= furthestOther * POINT_LEAD
}
