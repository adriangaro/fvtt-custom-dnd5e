import { MODULE, CONSTANTS } from '../constants.js'
import { getSetting } from '../utils.js'
import AttributesFields from "/systems/dnd5e/module/data/actor/templates/attributes.mjs";

export function patchPrepareEncumbrance () {
    if (game.modules.get('variant-encumbrance-dnd5e')?.active) return
    AttributesFields.prepareEncumbrance = prepareEncumbrancePatch;
}

function prepareEncumbrancePatch(rollData) {
    const equippedMod = getSetting(CONSTANTS.ENCUMBRANCE.EQUIPPED_ITEM_WEIGHT_MODIFIER.SETTING.KEY) || 0
    const proficientEquippedMod = getSetting(CONSTANTS.ENCUMBRANCE.PROFICIENT_EQUIPPED_ITEM_WEIGHT_MODIFIER.SETTING.KEY) || 0
    const unequippedMod = getSetting(CONSTANTS.ENCUMBRANCE.UNEQUIPPED_ITEM_WEIGHT_MODIFIER.SETTING.KEY) || 0

    const config = CONFIG.DND5E.encumbrance;
    const encumbrance = this.attributes.encumbrance ??= {};
    const baseUnits = CONFIG.DND5E.encumbrance.baseUnits[this.parent.type]
      ?? CONFIG.DND5E.encumbrance.baseUnits.default;
    const unitSystem = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";

    // Get the total weight from items
    let weight = this.parent.items
        .filter(item => !item.container)
        .reduce((weight, item) => {
            const equipped = item.system.equipped
            const proficient = item.system.prof?.multiplier >= 1
            const mod = (proficient) ? Math.min(proficientEquippedMod, equippedMod) : equippedMod
            return weight + ((equipped) ? (item.system.totalWeightIn?.(baseUnits[unitSystem]) ?? 0) * mod : (item.system.totalWeightIn?.(baseUnits[unitSystem]) ?? 0) * unequippedMod || 0)
        }, 0)

    // [Optional] add Currency Weight (for non-transformed actors)
    const currency = this.currency;
    if ( game.settings.get("dnd5e", "currencyWeight") && currency ) {
      const numCoins = Object.values(currency).reduce((val, denom) => val + Math.max(denom, 0), 0);
      const currencyPerWeight = config.currencyPerWeight[unitSystem];
      weight += numCoins / currencyPerWeight;
    }

    // Determine the Encumbrance size class
    const keys = Object.keys(CONFIG.DND5E.actorSizes);
    const index = keys.findIndex(k => k === this.traits.size);
    const sizeConfig = CONFIG.DND5E.actorSizes[
      keys[this.parent.flags.dnd5e?.powerfulBuild ? Math.min(index + 1, keys.length - 1) : index]
    ];
    const mod = sizeConfig?.capacityMultiplier ?? sizeConfig?.token ?? 1;
    let maximumMultiplier;
    
    const calculateThreshold = threshold => {
      let base = this.abilities.str?.value ?? 10;
      const bonus = simplifyBonus(encumbrance.bonuses?.[threshold], rollData)
        + simplifyBonus(encumbrance.bonuses?.overall, rollData);
      let multiplier = simplifyBonus(encumbrance.multipliers[threshold], rollData)
        * simplifyBonus(encumbrance.multipliers.overall, rollData);
      if ( threshold === "maximum" ) maximumMultiplier = multiplier;
      if ( this.parent.type === "vehicle" ) base = this.attributes.capacity.cargo;
      else multiplier *= (config.threshold[threshold]?.[unitSystem] ?? 1) * mod;
      return (base * multiplier).toNearest(0.1) + bonus;
    };

    // Populate final Encumbrance values
    encumbrance.value = weight.toNearest(0.1);
    encumbrance.thresholds = {
      encumbered: calculateThreshold("encumbered"),
      heavilyEncumbered: calculateThreshold("heavilyEncumbered"),
      maximum: calculateThreshold("maximum")
    };
    encumbrance.max = encumbrance.thresholds.maximum;
    encumbrance.mod = (mod * maximumMultiplier).toNearest(0.1);
    encumbrance.stops = {
      encumbered: Math.clamp((encumbrance.thresholds.encumbered * 100) / encumbrance.max, 0, 100),
      heavilyEncumbered: Math.clamp((encumbrance.thresholds.heavilyEncumbered * 100) / encumbrance.max, 0, 100)
    };
    encumbrance.pct = Math.clamp((encumbrance.value * 100) / encumbrance.max, 0, 100);
    encumbrance.encumbered = encumbrance.value > encumbrance.heavilyEncumbered;
}
