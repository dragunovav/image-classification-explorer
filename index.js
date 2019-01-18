/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tf from '@tensorflow/tfjs';
const JSZip = require('jszip');
const FileSaver = require('file-saver');

import {Dataset} from './dataset';
import {Results} from './results';
import * as ui from './ui';
import * as modal from './modal';
import {Webcam} from './webcam';

// Later, maybe allow users to pick these values themselves?
const LEARNING_RATE = 0.0001;
const BATCH_SIZE_FRACTION = 0.4;
const EPOCHS = 20;
const DENSE_UNITS = 100;

// Variables for containing the model datasets, prediction results,
// the models themselves, and the webcam
const trainingDataset = new Dataset(); 
const testingDataset = new Dataset(); 
// const trainingDatasetMobilenet = new Dataset();
// const testingDatasetMobilenet = new Dataset();
// const trainingDatasetSqueezenet = new Dataset();
// const testingDatasetSqueezenet = new Dataset();

var trainingImgDictMobilenet = {};
var trainingImgDictSqueezenet = {};
var testingImgDictMobilenet = {}; 
var testingImgDictSqueezenet = {}; 

var trainingActivDictMobilenet = {};
var trainingActivDictSqueezenet = {};
var testingActivDictMobilenet = {}; 
var testingActivDictSqueezenet = {}; 

let trainingResults;
let testingResults;

let mobilenet;
let squeezenet; 
let model;

// let mobilenet_original;
// let squeezenet_original;

const webcam = new Webcam(document.getElementById('webcam'));

// Loads mobilenet and returns a model that returns the internal activation
// we'll use as input to our classifier model.
async function loadMobilenet() {
  const mobilenet = await tf.loadModel(
      'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
  
  const layer = mobilenet.getLayer('conv_pw_13_relu');
  return tf.model({inputs: mobilenet.inputs, outputs: layer.output});
}

// Loads squeezenet and returns a model that returns the internal activation
// we'll use as input to our classifier model.
async function loadSqueezenet() {
  const squeezenet = await tf.loadModel('http://127.0.0.1:8080/model.json'); // go to squeezenet folder, http-server . --cors -o
  return squeezenet;
}

// function cloneObject(obj) {
//   var clone = {};
//   for(var i in obj) {
//       if(obj[i] != null &&  typeof(obj[i])=="object")
//           clone[i] = cloneObject(obj[i]);
//       else
//           clone[i] = obj[i];
//   }
//   return clone;
// }
function cloneEvent(e) {
  if (e===undefined || e===null) return undefined;
  function ClonedEvent() {};  
  let clone=new ClonedEvent();
  for (let p in e) {
      let d=Object.getOwnPropertyDescriptor(e, p);
      if (d && (d.get || d.set)) Object.defineProperty(clone, p, d); else clone[p] = e[p];
  }
  Object.setPrototypeOf(clone, e);
  return clone;
}
// Methods for updating the dataset objects from the ui
ui.setAddExampleHandler((labelId, datasetName) => {
  tf.tidy(async () => {
    // const img = tf.keep(webcam.capture());
    const img = webcam.capture(); // TODO: fix issue here.. for some reason it disposes the tensor once we start predicting... 
    // const img_copy = cloneEvent(img); 

    // process and add activations for both models 
    if (datasetName === "training") {
      var s = squeezenet.predict(img); 
      var m = mobilenet.predict(img); 
      if ((labelId in trainingImgDictMobilenet) && (labelId in trainingImgDictSqueezenet)) {
        trainingImgDictMobilenet[labelId].push(tf.keep(img)); 
        trainingImgDictSqueezenet[labelId].push(tf.keep(img)); 
        trainingActivDictMobilenet[labelId].push(tf.keep(m)); 
        trainingActivDictSqueezenet[labelId].push(tf.keep(s)); 
      } else {
        trainingImgDictMobilenet[labelId] = [tf.keep(img)]; 
        trainingImgDictSqueezenet[labelId] = [tf.keep(img)]; 
        trainingActivDictMobilenet[labelId] = [tf.keep(m)]; 
        trainingActivDictSqueezenet[labelId] = [tf.keep(s)]
      }
      ui.drawThumb(img, datasetName, labelId);
    } else {
      var s = squeezenet.predict(img); 
      var m = mobilenet.predict(img); 
      if ((labelId in testingImgDictMobilenet) && (labelId in testingImgDictSqueezenet)) {
        testingImgDictMobilenet[labelId].push(tf.keep(img)); 
        testingImgDictSqueezenet[labelId].push(tf.keep(img)); 
        testingActivDictMobilenet[labelId].push(tf.keep(m)); 
        testingActivDictSqueezenet[labelId].push(tf.keep(s)); 
      } else {
        testingImgDictMobilenet[labelId] = [tf.keep(img)]; 
        testingImgDictSqueezenet[labelId] = [tf.keep(img)]; 
        testingActivDictMobilenet[labelId] = [tf.keep(m)]; 
        testingActivDictSqueezenet[labelId] = [tf.keep(s)]
      }
      ui.drawThumb(img, datasetName, labelId);
    }

    // img.dispose();

  });
});

ui.setAddLabelHandler(labelName => {
  testingDataset.addLabel(labelName);
  return trainingDataset.addLabel(labelName);
});
ui.setRemoveLabelHandler(labelId => {
  delete trainingImgDictMobilenet[labelId]; 
  delete trainingImgDictSqueezenet[labelId]; 
  delete testingImgDictMobilenet[labelId]; 
  delete testingImgDictSqueezenet[labelId]; 

  delete trainingActivDictMobilenet[labelId]; 
  delete trainingActivDictSqueezenet[labelId]; 
  delete testingActivDictMobilenet[labelId]; 
  delete testingActivDictSqueezenet[labelId]; 

  testingDataset.removeLabel(labelId);
  trainingDataset.removeLabel(labelId);
});

// Methods to supply results to the results modal
modal.setGetResultsHandler(() => {
  if (ui.getCurrentTab() == "training") {
    return trainingResults;
  } else {
    return testingResults;
  }
});

// Sets up and trains the classifier
async function train() {
  if ((Object.values(trainingImgDictMobilenet) == []) || (Object.values(trainingImgDictSqueezenet) == [])) {
    throw new Error('Add some examples before training!');
  }

  // TODO: create clear fxn that also gets rid of old tensors 
  trainingDataset.removeExamples();
  testingDataset.removeExamples();

  console.log("raw training images"); 
  console.log(trainingImgDictMobilenet); 
  console.log(trainingImgDictSqueezenet); 

  console.log("raw testing  images");
  console.log(testingImgDictMobilenet); 
  console.log(testingImgDictSqueezenet); 

  // TODO: check model input, load appropriate model, and create trainingData and testingData
  // look at input from dropdown menu 
  var selected_model = document.getElementById("choose-model-dropdown").value;
  console.log(selected_model);

  // Get data from the training dataset
  if (selected_model == "SqueezeNet") { 
    console.log("Training on Squeezenet!"); 
    for (var label in trainingImgDictSqueezenet) {
      console.log(trainingImgDictSqueezenet[label]);
      console.log(trainingActivDictSqueezenet[label]);

      for (let img in trainingImgDictSqueezenet[label]) {
        console.log(trainingImgDictSqueezenet[label][img]); 
        console.log(trainingActivDictSqueezenet[label][img]); 
        trainingDataset.addExample(trainingImgDictSqueezenet[label][img], trainingActivDictSqueezenet[label][img], label); 
      }
    }
  } else {
    console.log("Training on Mobilenet!"); 
    for (var label in trainingImgDictMobilenet) {
      console.log(trainingImgDictMobilenet[label]); 
      console.log(trainingActivDictMobilenet[label]);

      for (let img in trainingImgDictMobilenet[label]) {
        console.log(trainingImgDictMobilenet[label][img]);
        console.log(trainingActivDictMobilenet[label][img]); 
        trainingDataset.addExample(trainingImgDictMobilenet[label][img], trainingActivDictMobilenet[label][img], label); 
      }
    }
  }



  // // Get data from the training dataset
  // const trainingData = await tf.tidy(() => { 
  //   return trainingDataset.getData(); 
  // });

  // for (var label in testingImgDict) {
  //   for (var img in testingImgDict[label]) {
  //     testingDataset.addExample(testingImgDict[label][img], mobilenet.predict(testingImgDict[label][img]), label); 
  //   }
  // }

  // console.log("checking isDisposedInternal status after adding examples...")
  // // loop over trainingImgDict and testingImgDict and process 
  // for (var label in trainingImgDict) {
  //   for (var img in trainingImgDict[label]) {
  //     console.log("current image - before predict");
  //     console.log(trainingImgDict[label][img]["isDisposedInternal"]); 
  //     console.log("current image - after predict");
  //     console.log(trainingImgDict[label][img]["isDisposedInternal"]); 
  //   }
  // }

  // Creates a 2-layer fully connected model. By creating a separate model,
  // rather than adding layers to the mobilenet model, we "freeze" the weights
  // of the mobilenet model, and only train weights from the new model.
  model = tf.sequential({
    layers: [
      // Flattens the input to a vector so we can use it in a dense layer. While
      // technically a layer, this only performs a reshape (and has no training
      // parameters).
      tf.layers.flatten({inputShape: [7, 7, 256]}),
      // Layer 1
      tf.layers.dense({
        units: DENSE_UNITS,
        activation: 'relu',
        kernelInitializer: 'varianceScaling',
        useBias: true
      }),
      // Layer 2. The number of units of the last layer should correspond
      // to the number of classes we want to predict.
      tf.layers.dense({
        units: trainingDataset.numLabels,
        kernelInitializer: 'varianceScaling',
        useBias: false,
        activation: 'softmax'
      })
    ]
  });

  // We use categoricalCrossentropy which is the loss function we use for
  // categorical classification which measures the error between our predicted
  // probability distribution over classes (probability that an input is of each
  // class), versus the label (100% probability in the true class)>
  const optimizer = tf.train.adam(LEARNING_RATE);
  model.compile({optimizer: optimizer, loss: 'categoricalCrossentropy'});

  // Get data from the training dataset
  const trainingData = await tf.tidy(() => {
    return trainingDataset.getData();
  });

  // // TODO: check model input, load appropriate model, and create trainingData and testingData
  // // look at input from dropdown menu 
  // var selected_model = document.getElementById("choose-model-dropdown").value;
  // console.log(selected_model);

  // // Get data from the training dataset
  // const trainingData = await tf.tidy(() => {
  //   if (selected_model == "SqueezeNet") { 
  //     console.log("Training on Squeezenet!"); 
  //     return trainingDatasetSqueezenet.getData(); 
  //   } else if (selected_model == "MobileNet") { 
  //     console.log("Training on Mobilenet!"); 
  //     return trainingDatasetMobilenet.getData(); 
  //   } else {
  //     console.log("Training on Mobilenet by default!"); 
  //     return trainingDatasetMobilenet.getData(); 
  //   }
  // });

  // We parameterize batch size as a fraction of the entire dataset because the
  // number of examples that are collected depends on how many examples the user
  // collects. This allows us to have a flexible batch size.
  const batchSize =
      Math.floor(trainingData.xs.shape[0] * BATCH_SIZE_FRACTION);
  if (!(batchSize > 0)) {
    throw new Error(
        `Batch size is 0 or NaN. Please choose a non-zero fraction.`);
  }

  // Train the model! Model.fit() will shuffle xs & ys so we don't have to.
  await model.fit(trainingData.xs, trainingData.ys, {
    batchSize,
    epochs: EPOCHS,
    callbacks: {
      onBatchEnd: async (batch, logs) => {
        ui.trainStatus('Loss: ' + logs.loss.toFixed(5));
      }
    }
  });
}

// Uses the classifier to classify examples
async function predict(dataset, modelLabelsJson) {
  const datasetData = await tf.tidy(() => {
    return dataset.getData();
  });

  const predictedClass = tf.tidy(() => {
    // Make predictions from the mobilenet activations of the dataset
    return model.predict(datasetData.xs);
  });

  const labelNamesMap = JSON.parse(modelLabelsJson);

  const numPredictions = Math.min(3, Object.keys(labelNamesMap).length);
  const topPredictions = await predictedClass.topk(numPredictions);

  const predictedIndices = await topPredictions.indices.data();
  const predictedValues = await topPredictions.values.data();

  const actualIndices = await datasetData.ys.argMax(1).data();

  predictedClass.dispose();

  return new Results(datasetData.imgs, actualIndices, predictedIndices, predictedValues, labelNamesMap);
}

// Train and predict button functionality. Also updates the results' prev/next buttons.
let resultsPrevButtonFunctionTraining = null;
let resultsNextButtonFunctionTraining = null;

document.getElementById('train').addEventListener('click', async () => {
  ui.trainStatus('Training...');
  await tf.nextFrame();
  await tf.nextFrame();
  await train();

  trainingResults = await predict(trainingDataset, trainingDataset.getCurrentLabelNamesJson());
  ui.updateResult(trainingResults.getNextResult(), "training");

  const resultsPrevButton = document.getElementById("results-image-button-prev-training");
  const resultsNextButton = document.getElementById("results-image-button-next-training");

  if (resultsPrevButtonFunctionTraining != null) {
    resultsPrevButton.removeEventListener('click', resultsPrevButtonFunctionTraining);
    resultsNextButton.removeEventListener('click', resultsNextButtonFunctionTraining);
  }

  resultsPrevButtonFunctionTraining = () => {
    ui.updateResult(trainingResults.getPreviousResult(), "training");
  }

  resultsNextButtonFunctionTraining = () => {
    ui.updateResult(trainingResults.getNextResult(), "training");
  }

  resultsPrevButton.addEventListener('click', resultsPrevButtonFunctionTraining);
  resultsNextButton.addEventListener('click', resultsNextButtonFunctionTraining);
});

let resultsPrevButtonFunctionTesting = null;
let resultsNextButtonFunctionTesting = null;

document.getElementById('predict').addEventListener('click', async () => {
  // xxxxxxxxx
  if (selected_model == "SqueezeNet") { 
    console.log("Testing on Squeezenet!"); 
    testingResults = await predict(testingDatasetSqueezenet, trainingDatasetSqueezenet.getCurrentLabelNamesJson());
  } else if (selected_model == "MobileNet") { 
    console.log("Testing on Mobilenet!"); 
    testingResults = await predict(testingDatasetMobilenet, trainingDatasetMobilenet.getCurrentLabelNamesJson());
  } else {
    console.log("Testing on Mobilenet by default!"); 
    testingResults = await predict(testingDatasetMobilenet, trainingDatasetMobilenet.getCurrentLabelNamesJson());
  }
  ui.updateResult(testingResults.getNextResult(), "testing");

  const resultsPrevButton = document.getElementById("results-image-button-prev-testing");
  const resultsNextButton = document.getElementById("results-image-button-next-testing");

  if (resultsPrevButtonFunctionTesting != null) {
    resultsPrevButton.removeEventListener('click', resultsPrevButtonFunctionTesting);
    resultsNextButton.removeEventListener('click', resultsNextButtonFunctionTesting);
  }

  resultsPrevButtonFunctionTesting = () => {
    ui.updateResult(testingResults.getPreviousResult(), "testing");
  }

  resultsNextButtonFunctionTesting = () => {
    ui.updateResult(testingResults.getNextResult(), "testing");
  }

  resultsPrevButton.addEventListener('click', resultsPrevButtonFunctionTesting);
  resultsNextButton.addEventListener('click', resultsNextButtonFunctionTesting);
});

// Download and upload button functionality.

document.getElementById('download-button').addEventListener('click', async () => {
  const zipSaver = {save: function(modelSpecs) {
    const modelTopologyFileName = "model.json";
    const weightDataFileName = "model.weights.bin";
    const modelLabelsName = "model_labels.json";
    const modelZipName = "model.mdl";

    const weightsBlob = new Blob(
      [modelSpecs.weightData], {type: 'application/octet-stream'});

    const weightsManifest = [{
      paths: ['./' + weightDataFileName],
      weights: modelSpecs.weightSpecs
    }];
    const modelTopologyAndWeightManifest = {
      modelTopology: modelSpecs.modelTopology,
      weightsManifest
    };
    const modelTopologyAndWeightManifestBlob = new Blob(
      [JSON.stringify(modelTopologyAndWeightManifest)],
      {type: 'application/json'});

    const zip = new JSZip();
    zip.file(modelTopologyFileName, modelTopologyAndWeightManifestBlob);
    zip.file(weightDataFileName, weightsBlob);
    zip.file(modelLabelsName, trainingDataset.getCurrentLabelNamesJson());

    zip.generateAsync({type:"blob"})
      .then(function (blob) {
          FileSaver.saveAs(blob, modelZipName);
      });
  }};

  const savedModel = await model.save(zipSaver);
});

function blobToFile(blob, fileName) {
  // A Blob() is almost a File() - it's just missing the two properties below which we will add
  blob.lastModifiedDate = new Date();
  blob.name = fileName;
  return blob;
}

const modelUpload = document.getElementById('model-upload');

document.getElementById('upload-button').addEventListener('click', async () => {
  modelUpload.click();
});

modelUpload.addEventListener('change', async () => {
  const modelZipFile = modelUpload.files[0];

  const modelJsonName = "model.json";
  const modelWeightsName = "model.weights.bin";
  const modelLabelsName = "model_labels.json";

  const modelFiles = await JSZip.loadAsync(modelZipFile);
  const modelJsonBlob = await modelFiles.file(modelJsonName).async("blob");
  const modelWeightsBlob = await modelFiles.file(modelWeightsName).async("blob");
  const modelLabelsText = await modelFiles.file(modelLabelsName).async("text");

  const modelJsonFile = blobToFile(modelJsonBlob, modelJsonName);
  const modelWeightsFile = blobToFile(modelWeightsBlob, modelWeightsName);

  model = await tf.loadModel(
    tf.io.browserFiles([modelJsonFile, modelWeightsFile]));
  trainingDataset.setCurrentLabelNames(modelLabelsText);

  const modelLabelsJson = JSON.parse(modelLabelsText);

  ui.removeLabels();
  for (let labelNumber in modelLabelsJson) {
    if (modelLabelsJson.hasOwnProperty(labelNumber)) {
        ui.addLabel(modelLabelsJson[labelNumber]);
    }
  }

  modelUpload.value = "";
});

// Initialize the application

async function init() {
  try {
    await webcam.setup();
  } catch (e) {
    document.getElementById('no-webcam').style.display = 'block';
  }

  console.log(await tf.io.listModels()); 

  mobilenet = await loadMobilenet();
  squeezenet = await loadSqueezenet(); 
  console.log('Loaded models.')

  // Warm up the models so that the first time we use it will be quick
  tf.tidy(() => mobilenet.predict(webcam.capture()));
  tf.tidy(() => squeezenet.predict(webcam.capture()));

  ui.init();
  modal.init();
}

init();