// The admin testing mode's switches. Only the admin panel (game/admin/AdminMode) ever turns one
// on; gameplay code just reads them, so in a normal game they stay off and cost nothing.
export const CHEATS = {
  /** the hunter takes no damage of any kind */
  god: false,
  /** the cylinder (or Mark's crests in hand) never runs dry */
  infAmmo: false,
};
