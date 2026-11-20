# LeakBack — Live Lab

Find hidden pipe leaks with the pressure sensors a utility already has.
Xylem Global Student Innovation Challenge 2026 · University Track · Challenge #1 Water Quantity.

**Open it:** https://xsx11223.github.io/leakback/

## What runs in your browser

- **Live twin** (`lab/`): the real EPANET 2.3 hydraulic engine compiled to WebAssembly ([epanet-js](https://github.com/modelcreate/epanet-js), MIT, bundled in `lab/vendor/`) solves the L-Town network (782 junctions, 905 pipes) every time you click. Create a leak on any pipe, change the time of day, hole size, sensor noise, or make the "real" town differ from the model by up to ±10%. Two neural networks then locate the leak from the 33 pressure sensors only:
  - **LeakBack**: trained on about 28,000 simulated leaks, each on a randomly perturbed copy of the network (domain randomisation), with a conformal 90% search area.
  - **Standard model**: same network, trained only on the nominal model.
  The stress test drops 100 random leaks and scores both models live.
- **Real 2019 data** (`app/`): replay of the BattLeDIM 2020 benchmark's real 2019 sensor data with LeakBack's alarms, scored with the official rules (EUR 133,688; 9 of 19 new leaks found; median location error 237 m).

No server, no install. All computation happens in the page.

## Data and credits

- BattLeDIM 2020 dataset and L-Town model: Vrachimis et al., Zenodo [10.5281/zenodo.4017659](https://doi.org/10.5281/zenodo.4017659), CC BY 4.0.
- EPANET (US EPA / OpenWaterAnalytics) via epanet-js, MIT.
- Model training: WNTR, scikit-learn. AI assistants (Anthropic Claude) helped write code.
