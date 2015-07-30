'use strict';

module.exports = PLS;
var Matrix = require('ml-matrix');
var Utils = require('./utils');

/**
 * Function that returns the index where the sum of each
 * column vector is maximum.
 * @param {Matrix} X
 * @returns {number} index of the maximum
 */
function maxSumColIndex(X) {
    var maxIndex = 0;
    var maxSum = -Infinity;
    for(var i = 0; i < X.columns; ++i) {
        var currentSum = X.getColumnVector(i).sum();
        if(currentSum > maxSum) {
            maxSum = currentSum;
            maxIndex = i;
        }
    }
    return maxIndex;
}

/**
 * Constructor of the PLS model.
 * @param reload - used for load purposes.
 * @param model - used for load purposes.
 * @constructor
 */
function PLS(reload, model) {
    if(reload) {
        this.E = model.E;
        this.F = model.F;
        this.ssqYcal = model.ssqYcal;
        this.R2X = model.R2X;
        this.ymean = model.ymean;
        this.ystd = model.ystd;
        this.PBQ = model.PBQ;
        this.T = model.T;
        this.P = model.P;
        this.U = model.U;
        this.Q = model.Q;
        this.W = model.W;
        this.B = model.B;
    }
}

/**
 * Function that fit the model with the given data and predictions, in this function is calculated the
 * following outputs:
 *
 * T - Score matrix of X
 * P - Loading matrix of X
 * U - Score matrix of Y
 * Q - Loading matrix of Y
 * B - Matrix of regression coefficient
 * W - Weight matrix of X
 *
 * @param {Matrix} trainingSet - Dataset to be apply the model
 * @param {Matrix} predictions - Predictions over each case of the dataset
 * @param {Number} options - recieves the latentVectors and the tolerance of each step of the PLS
 */
PLS.prototype.train = function (trainingSet, predictions, options) {

    if(options === undefined) options = {};

    var latentVectors = options.latentVectors;
    if(latentVectors === undefined || isNaN(latentVectors)) {
        throw new RangeError("Latent vector must be a number.");
    }

    var tolerance = options.tolerance;
    if(tolerance === undefined || isNaN(tolerance)) {
        throw new RangeError("Tolerance must be a number");
    }

    if(trainingSet.length !== predictions.length)
        throw new RangeError("The number of predictions and elements in the dataset must be the same");

    //var tolerance = 1e-9;
    var X = Utils.featureNormalize(Matrix(trainingSet, true)).result;
    var resultY = Utils.featureNormalize(Matrix(predictions, true));
    this.ymean = resultY.means.neg();
    this.ystd = resultY.std;
    var Y = resultY.result;

    var rx = X.rows;
    var cx = X.columns;
    var ry = Y.rows;
    var cy = Y.columns;

    if(rx != ry) {
        throw new RangeError("dataset cases is not the same as the predictions");
    }

    var ssqXcal = X.clone().mul(X).sum(); // for the r²
    var sumOfSquaresY = Y.clone().mul(Y).sum();

    var n = latentVectors; //Math.max(cx, cy); // components of the pls
    var T = Matrix.zeros(rx, n);
    var P = Matrix.zeros(cx, n);
    var U = Matrix.zeros(ry, n);
    var Q = Matrix.zeros(cy, n);
    var B = Matrix.zeros(n, n);
    var W = P.clone();
    var k = 0;
    var R2X = new Array(n);

    while(Utils.norm(Y) > tolerance && k < n) {
        var transposeX = X.transpose();
        var transposeY = Y.transpose();

        var tIndex = maxSumColIndex(X.clone().mulM(X));
        var uIndex = maxSumColIndex(Y.clone().mulM(Y));

        var t1 = X.getColumnVector(tIndex);
        var u = Y.getColumnVector(uIndex);
        var t = Matrix.zeros(rx, 1);

        while(Utils.norm(t1.clone().sub(t)) > tolerance) {
            var w = transposeX.mmul(u);
            w.div(Utils.norm(w));
            t = t1;
            t1 = X.mmul(w);
            var q = transposeY.mmul(t1);
            q.div(Utils.norm(q));
            u = Y.mmul(q);
        }

        t = t1;
        var num = transposeX.mmul(t);
        var den = (t.transpose().mmul(t))[0][0];
        var p = num.div(den);
        var pnorm = Utils.norm(p);
        p.div(pnorm);
        t.mul(pnorm);
        w.mul(pnorm);

        num = u.transpose().mmul(t);
        den = (t.transpose().mmul(t))[0][0];
        var b = (num.div(den))[0][0];
        X.sub(t.mmul(p.transpose()));
        Y.sub(t.clone().mul(b).mmul(q.transpose()));

        T.setColumn(k, t);
        P.setColumn(k, p);
        U.setColumn(k, u);
        Q.setColumn(k, q);
        W.setColumn(k, w);

        B[k][k] = b;
        k++;
    }

    k--;
    T = T.subMatrix(0, T.rows - 1, 0, k);
    P = P.subMatrix(0, P.rows - 1, 0, k);
    U = U.subMatrix(0, U.rows - 1, 0, k);
    Q = Q.subMatrix(0, Q.rows - 1, 0, k);
    W = W.subMatrix(0, W.rows - 1, 0, k);
    B = B.subMatrix(0, k, 0, k);

    this.R2X = t.transpose().mmul(t).mmul(p.transpose().mmul(p)).divS(ssqXcal)[0][0];

    // TODO: review of R2Y
    //this.R2Y = t.transpose().mmul(t).mul(q[k][0]*q[k][0]).divS(ssqYcal)[0][0];

    this.ssqYcal = sumOfSquaresY;
    this.E = X;
    this.F = Y;
    this.T = T;
    this.P = P;
    this.U = U;
    this.Q = Q;
    this.W = W;
    this.B = B;
    this.PBQ = P.mmul(B).mmul(Q.transpose());
};

/**
 * Function that predict the behavior of the given dataset.
 * @param dataset - data to be predicted.
 * @returns {Matrix} - predictions of each element of the dataset.
 */
PLS.prototype.predict = function (dataset) {
    var X = Matrix(dataset, true);
    var normalization = Utils.featureNormalize(X);
    X = normalization.result;
    var Y = X.mmul(this.PBQ);
    Y.mulRowVector(this.ystd);
    Y.addRowVector(this.ymean);
    return Y;
};

/**
 * Function that returns the explained variance on training of the PLS model.
 * @returns {number}
 */
PLS.prototype.getExplainedVariance = function () {
    return this.R2X;
};

/**
 * Load a PLS model from an Object
 * @param model
 * @returns {PLS} - PLS object from the given model
 */
PLS.load = function (model) {
    if(model.modelName !== 'PLS')
        throw new RangeError("The current model is invalid!");

    return new PLS(true, model);
};

/**
 * Function that exports a PLS model to an Object.
 * @returns {{modelName: string, ymean: *, ystd: *, PBQ: *}} model.
 */
PLS.prototype.export = function () {
    return {
        modelName: "PLS",
        E: this.E,
        F: this.F,
        R2X: this.R2X,
        ssqYcal: this.ssqYcal,
        ymean: this.ymean,
        ystd: this.ystd,
        PBQ: this.PBQ,
        T: this.T,
        P: this.P,
        U: this.U,
        Q: this.Q,
        W: this.W,
        B: this.B
    };
};
