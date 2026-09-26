import { randomInt } from 'node:crypto';

export { isValidSlug } from '../public/assets/js/slug.js';

// Short, common words that are easy to say out loud and type on a phone.
const WORDS = `
  acorn agate alpine amber anchor apple apricot arrow aspen atlas aurora autumn avocado
  bagel bamboo banana banjo barley basil bay beacon beagle beam bean bear beaver berry birch
  bison blossom blue bolt bonsai breeze brick brook bubble buffalo bunny butter button
  cabin cactus cake camel canoe canyon caramel cardinal carrot cashew castle cedar cello
  chalk charm cherry chess chestnut cider cinnamon citrus clay cliff clover cobalt cocoa
  coconut comet compass copper coral cotton cougar coyote crane crayon creek cricket crown
  crystal cupcake curry cycle cypress daisy dawn delta desert dingo dolphin donut dove
  dragon drift drum dune eagle echo eclipse elm ember emerald falcon feather fern ferry
  fig finch fjord flame flint flute foam forest fossil fox frost fudge galaxy garden garnet
  gecko geyser ginger glacier glow goose granite grape gravel grove guava gull harbor
  harp hawk hazel heron hickory hill honey horizon husky igloo indigo iris island ivory
  ivy jade jaguar jasmine jelly jet juniper kayak kelp kettle kiwi koala lagoon lake
  lantern larch lava lemon lilac lily lime linen lion llama lotus lunar lynx magnet
  mango maple marble marsh meadow melon mercury meteor mint mocha moon moose moss
  mountain muffin nectar nest nickel noodle nova nutmeg oak oasis ocean olive onyx opal
  orange orbit orchid otter owl oyster paddle palm panda papaya parrot peach peanut pearl
  pebble pecan pelican penguin pepper piano pickle pine pixel planet plum polar pony poppy
  prairie prism puffin pumpkin quail quartz quill rabbit radar rain raven reef ridge river
  robin rocket rose ruby saffron sage salmon sand sapphire satin scarlet sequoia shell
  sierra silk silver sky slate sloth snow sonic spark sparrow spice spruce squid star
  stone storm sugar summit sun swan tango tea thunder tiger timber toast topaz tulip
  tundra turtle twig valley vanilla velvet violet volcano waffle walnut walrus wave whale
  willow wind wolf wren yak yarn yeti zebra zen zephyr zinc
`.trim().split(/\s+/);

export function randomWord() {
  return WORDS[randomInt(WORDS.length)];
}

// Used only when the plain words are busy: "otter7", "otter42".
export function randomWordWithNumber() {
  return `${randomWord()}${randomInt(2, 100)}`;
}
