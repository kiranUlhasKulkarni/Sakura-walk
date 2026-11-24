import { Vector3 } from 'three';
import { lanePoint, laneSide } from '../../world/lane.js';

/**
 * Prelude — the establishing shot. A slow crane from high over the park gate
 * down through the blossoms onto the lane, settling over the couple's
 * shoulders as they stand at the gate with their cats, looking down the
 * lantern-lit avenue ahead of them; then control passes to the user.
 */
export const Prelude = {
  name: 'prelude',
  async enter(ctx) {
    const { rig, cast } = ctx.app;
    const couple = cast ? cast.coupleCenter(new Vector3()) : lanePoint(0.02).setY(1.3);
    const fwd = lanePoint(0.06).sub(lanePoint(0.02)).setY(0).normalize();
    const side = laneSide(0.03);
    const ahead = lanePoint(0.14).setY(1.6);
    // 1) high above the gate grove, looking down the length of the lane
    rig.cut(couple.clone().addScaledVector(fwd, -14).addScaledVector(side, 9).setY(15), lanePoint(0.3).setY(2));
    // 2) crane down through the blossoms, drifting in behind them
    const over = couple.clone().addScaledVector(fwd, -3.6).addScaledVector(side, 1.6).setY(1.95);
    await rig.move({ to: over, look: ahead, via: couple.clone().addScaledVector(fwd, -9).addScaledVector(side, 5).setY(6), duration: 11 });
    // → the Explore act hands the camera to the third-person controller from exactly here
  },
};
