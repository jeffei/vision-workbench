"""Real automatic relationship inference against the running local server."""
import json
import unittest
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8765/api/relate'


class RelationAPI(unittest.TestCase):
    def request(self, image='horse', **data):
        with (ROOT / 'web/assets' / f'relate-{image}.jpg').open('rb') as f:
            return requests.post(URL, files={'file': f}, data=data, timeout=240)

    def test_reject_invalid_configuration(self):
        for data in ({'relation_model_id': '../unknown'}, {'model_id': 'unknown'},
                     {'relation_model_id': 'relsgg-vits16'}, {'threshold': 'nan'}, {'threshold': '1.1'}):
            self.assertEqual(self.request(**data).status_code, 400)

    def test_catalog_exposes_availability(self):
        data = requests.get(URL+'/models').json()
        self.assertEqual(len(data['models']), 7)
        self.assertEqual(sum(m['supported'] for m in data['models']), 5)
        self.assertTrue(all(m['url'].startswith('https://huggingface.co/maelic/') for m in data['models']))

    def test_reject_bad_image(self):
        response = requests.post(URL, files={'file': ('bad.jpg', b'invalid')})
        self.assertEqual(response.status_code, 400)

    def test_only_image_required_official_samples(self):
        for image, expected in [('horse', 'riding'), ('bicycle', 'riding'), ('tennis', 'holding')]:
            response = self.request(image)
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(data['prompt_mode'], 'free')
            self.assertEqual(data['relation_model'], 'relsgg-vits16plus')
            self.assertIn(expected, [r['predicate'] for r in data['relations']])
            self.assertEqual(len(data['predicates']), 35)
            for r in data['relations']:
                self.assertTrue(0 <= r['subject'] < len(data['detections']))
                self.assertTrue(0 <= r['object'] < len(data['detections']))
                self.assertNotEqual(r['subject'], r['object'])
                self.assertGreaterEqual(r['score'], 0.56)
                self.assertIn(r['predicate'], data['predicates'])

    def test_switch_relation_and_detector_models(self):
        for model, detector in [('relsgg-convnext-tiny', 'yoloe-11s'), ('relsgg-vits16plus', 'yoloe-v8s')]:
            response = self.request(relation_model_id=model, model_id=detector)
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(data['relation_model'], model)
            self.assertEqual(data['model_id'], detector)
            meta = json.loads((ROOT / 'vendor/RelateAnything-main/deploy/dist' / model / 'relateanything.json').read_text())
            self.assertEqual(data['calibration'], meta['calibration'])
            self.assertGreater(len(data['relations']), 0)

    def test_cached_candidates_support_lowering_and_raising_threshold(self):
        high = self.request(threshold='0.95')
        self.assertEqual(high.status_code, 200, high.text)
        data = high.json()
        self.assertEqual(data['relations'], [])
        candidates = data['relation_candidates']
        self.assertGreater(len(candidates), 24)
        self.assertEqual(len({r['id'] for r in candidates}), len(candidates))
        low = self.request(threshold='0.56')
        self.assertEqual(low.status_code, 200, low.text)
        filtered = [r for r in candidates if r['score'] >= .56][:data['relation_limit']]
        actual = low.json()['relations']
        self.assertEqual([(r['subject'], r['predicate'], r['object']) for r in filtered],
                         [(r['subject'], r['predicate'], r['object']) for r in actual])
        for cached, fresh in zip(filtered, actual):
            self.assertAlmostEqual(cached['score'], fresh['score'], delta=1e-4)
        self.assertGreater(len(filtered), 0)



if __name__ == '__main__':
    unittest.main()
