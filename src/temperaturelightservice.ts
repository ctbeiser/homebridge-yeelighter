import { AdaptiveLightingController, AdaptiveLightingControllerMode } from "homebridge";
import {
  LightServiceParameters,
  LightService,
  POWERMODE_CT,
  POWERMODE_MOON,
  convertColorTemperature,
  Attributes,
  powerModeFromColorModeAndActiveMode,
  ConcreteLightService
} from "./lightservice";

export class TemperatureLightService extends LightService implements ConcreteLightService {
  private adaptiveLightingController: AdaptiveLightingController;
  private pendingCt?: number;
  constructor(parameters: LightServiceParameters) {
    super(parameters);
    this.service.displayName = "Temperature Light";
    this.installHandlers();
    this.adaptiveLightingController = new this.platform.AdaptiveLightingController(this.service, {
      controllerMode: AdaptiveLightingControllerMode.AUTOMATIC
    });
    this.accessory.configureController(this.adaptiveLightingController);
  }

  private getBrightness(attributes): number {
    if (this.specs.nightLight && false) {
      const { bright, nl_br, active_mode } = attributes;
      const br1 = Number(bright);
      const br2 = Number(nl_br);
      return active_mode === 0 ? br1 / 2 + 50 : br2 / 2;
    } else {
      return attributes.bright;
    }
  }

  private async sendPower(mode?: number) {
    if (mode === undefined) {
      this.setAttributes({ power: false });
      await this.sendCommand("set_power", ["off", "smooth", 500]);
    } else {
      this.setAttributes({ power: true, active_mode: mode === POWERMODE_MOON ? 1 : 0 });
      if (this.pendingCt !== undefined) {
        const ct = this.pendingCt;
        this.pendingCt = undefined;
        await this.sendAnimatedCommand("set_ct_abx", ct);
        this.setAttributes({ ct });
      }
      await this.sendCommand("set_power", ["on", "sudden", 0, mode]);
      this.powerMode = mode;
    }
  }

  private async installHandlers() {
    this.handleCharacteristic(
      this.platform.Characteristic.On,
      async () => {
        const attributes = await this.attributes();
        return attributes.power;
      },
      async (value) => {
        if (this.config.ignorePower && value) {
          this.log(`Ignoring explicit power on`);
        } else {
          this.debug(`Manual power setting with powerMode: ${this.powerMode}`, value);
          this.setAttributes({ power: value });
          if (value) {
            this.sendPower(this.powerMode || POWERMODE_CT);
          } else {
            this.sendPower();
          }
        }
      }
    );
    this.handleCharacteristic(
      this.platform.Characteristic.Brightness,
      async () => {
        return this.getBrightness(await this.attributes());
      },
      async (value) => {
        if (value > 0) {
          const attributes = await this.light.getAttributes();
          const desiredMode = this.specs.nightLight && false && value < 50 ? POWERMODE_MOON : POWERMODE_CT;

          if (!attributes.power || (this.specs.nightLight && false && this.powerMode !== desiredMode)) {
            await this.sendPower(desiredMode);
          }

          let valueToSet = value;
          if (this.specs.nightLight && false) {
            valueToSet = value < 50 ? value * 2 - 1 : Math.max(1, (value - 50) * 2);
          }
          this.log(`set brightness ${value} (translated to ${valueToSet})`);
          await this.sendAnimatedCommand("set_bright", valueToSet);
          if (this.specs.nightLight && false && value < 50) {
            this.setAttributes({ power: true, nl_br: valueToSet, active_mode: 1 });
          } else {
            this.setAttributes({ power: true, bright: valueToSet, active_mode: 0 });
          }
        } else {
          this.log(`set brightness to 0, power off`);
          this.updateCharacteristic(this.platform.Characteristic.Brightness, 0);
          await this.sendPower();
          this.setAttributes({ power: false, bright: 0, nl_br: 0 });
        }
        this.saveDefaultIfNeeded();
      }
    );
    const characteristic = this.handleCharacteristic(
      this.platform.Characteristic.ColorTemperature,
      async () => {
        const attributes = await this.attributes();
        return convertColorTemperature(attributes.ct);
      },
      async (value) => {
        const kelvin = convertColorTemperature(value);
        const attributes = await this.light.getAttributes();
        if (!attributes.power) {
          this.pendingCt = kelvin;
          this.setAttributes({ ct: kelvin });
          return;
        }

        await this.ensurePowerMode(POWERMODE_CT);
        await this.sendAnimatedCommand("set_ct_abx", kelvin);
        this.setAttributes({ ct: kelvin });

        this.saveDefaultIfNeeded();
      }
    );
    characteristic.setProps({
      ...characteristic.props,
      maxValue: convertColorTemperature(this.specs.colorTemperature.min),
      minValue: convertColorTemperature(this.specs.colorTemperature.max)
    });
  }

  public onAttributesUpdated = (newAttributes: Attributes) => {
    this.debug("temperature light updated", newAttributes);
    this.powerMode = powerModeFromColorModeAndActiveMode(newAttributes.color_mode, newAttributes.active_mode);
    this.updateCharacteristic(this.platform.Characteristic.On, newAttributes.power);
    this.updateCharacteristic(this.platform.Characteristic.Brightness, this.getBrightness(newAttributes));
    this.updateCharacteristic(this.platform.Characteristic.ColorTemperature, convertColorTemperature(newAttributes.ct));
  };
}
