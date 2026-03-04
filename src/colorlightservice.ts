import {
  LightService,
  LightServiceParameters as LightServiceParameters,
  POWERMODE_HSV,
  convertColorTemperature,
  POWERMODE_CT,
  powerModeFromColorModeAndActiveMode,
  Attributes,
  ConcreteLightService
} from "./lightservice";

export class ColorLightService extends LightService implements ConcreteLightService {
  constructor(parameters: LightServiceParameters) {
    super(parameters);
    this.service.displayName = "Color Light";
    this.installHandlers();
  }

  private async installHandlers() {
    const allowCtForColor =
      this.platform.config.ctforcolor !== false && this.platform.config.ctforcolor !== "false";
    this.handleCharacteristic(
      this.platform.Characteristic.On,
      async () => this.getAttribute("power"),
      async (value) => {
        this.cancelAllDebounces();
        await this.sendCoalescedPowerCommand("set_power", [value ? "on" : "off", "smooth", 200, 0]);
        this.setAttributes({ power: value });
      }
    );
    this.handleCharacteristic(
      this.platform.Characteristic.Brightness,
      async () => this.getAttribute("bright"),
      async (value) => {
        this.log(`set brightness to ${value}`);
        if (value > 0) {
          await this.sendAnimatedCommand("set_bright", value);
          this.setAttributes({ power: true, bright: value });
        } else {
          this.cancelAllDebounces();
          await this.sendCoalescedPowerCommand("set_power", ["off", "sudden", 0]);
          this.setAttributes({ power: false });
          this.log(`set brightness to 0, power off`);
        }
        this.saveDefaultIfNeeded();
      }
    );
    if (allowCtForColor) {
      const characteristic = this.handleCharacteristic(
        this.platform.Characteristic.ColorTemperature,
        async () => {
          const attributes = await this.attributes();
          this.debug("getCT", { ct: attributes.ct });
          return convertColorTemperature(attributes.ct);
        },
        async (value) => {
          const kelvin = convertColorTemperature(value);
          await this.ensurePowerMode(POWERMODE_CT);
          this.debug(`setCT: ${convertColorTemperature(value)}`);
          await this.sendAnimatedCommand("set_ct_abx", kelvin);
          this.setAttributes({ ct: kelvin });
          this.updateColorFromCT(value);
          this.saveDefaultIfNeeded();
        }
      );
      characteristic.setProps({
        ...characteristic.props,
        maxValue: convertColorTemperature(this.specs.colorTemperature.min),
        minValue: convertColorTemperature(this.specs.colorTemperature.max)
      });
    }
    this.handleCharacteristic(
      this.platform.Characteristic.Hue,
      async () => {
        const attributes = await this.attributes();
        this.debug("getHue", { hue: attributes.hue });
        return attributes.hue;
      },
      async (value) => {
        this.lastHue = value;
        await this.setHSV();
      }
    );
    this.handleCharacteristic(
      this.platform.Characteristic.Saturation,
      async () => {
        const attributes = await this.attributes();
        this.debug("getSat", { sat: attributes.sat });
        return attributes.sat;
      },
      async (value) => {
        this.lastSat = value;
        await this.setHSV();
      }
    );
  }

  public onAttributesUpdated = (newAttributes: Attributes) => {
    this.debug("color light updated", newAttributes);
    this.powerMode = powerModeFromColorModeAndActiveMode(newAttributes.color_mode, newAttributes.active_mode);
    if (this.powerMode === POWERMODE_HSV) {
      this.updateCharacteristic(this.platform.Characteristic.Saturation, newAttributes.sat);
      this.updateCharacteristic(this.platform.Characteristic.Hue, newAttributes.hue);
      this.updateCharacteristic(this.platform.Characteristic.Brightness, newAttributes.bright);
    }
    if (this.powerMode === POWERMODE_CT) {
      this.updateCharacteristic(
        this.platform.Characteristic.ColorTemperature,
        convertColorTemperature(newAttributes.ct)
      );
    }
    this.updateCharacteristic(this.platform.Characteristic.On, newAttributes.power);
  };
}
