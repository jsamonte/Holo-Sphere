import TrackedHand from "../SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"

/**
 * Cosine of the largest bend, joint to joint, that still counts as a straight index finger. A
 * pointing finger stays close to straight at both its middle and top joints; a curled one - in a
 * fist, a pinch or a loosely relaxed hand - bends well past this at one of them.
 */
const STRAIGHT_JOINT_COS = Math.cos((40 * Math.PI) / 180)

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
